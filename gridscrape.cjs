#!/usr/bin/env node
// Lightning Google Maps scraper (no browser): splits the target area into grid
// tiles and hits Maps' internal search?tbm=map endpoint over plain HTTP using
// the captured pb template (pb-template.json). ~10 concurrent requests, each
// tile paginated 20-at-a-time, dedupe by place ID.
//
// Realtime by design: every batch of fresh leads is appended to the project CSV
// immediately (the dashboard polls row counts) and upserted into the global
// SQLite leads DB (so /leads grows while the scrape is still running).
//
// Usage: node gridscrape.js "<service> in <location>" [options]
//   --outDir <dir>        where the CSV lands (default output/)
//   --max <n>             stop after n unique leads
//   --project <name>      tag DB rows with this project (enables realtime DB upserts)
//   --concurrency <n>     parallel HTTP requests (default 10)
//   --maxPagesPerTile <n> pagination depth per tile (default 5 = 100 results)
//
// Exit codes: 0 ok, 1 error, 3 = query has no geocodable location (caller may
// fall back to the browser scraper).

const fs = require("fs");
const path = require("path");
const proxy = require("./web/lib/proxy.cjs");

const ROOT = __dirname;

// ---- args ---------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const positional = [];
const flagValues = {};
const VALUE_FLAGS = new Set(["--outDir", "--max", "--project", "--concurrency", "--maxPagesPerTile"]);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (VALUE_FLAGS.has(a)) flagValues[a] = rawArgs[++i];
  else if (!a.startsWith("--")) positional.push(a);
}
const QUERY = positional.join(" ").trim();
if (!QUERY) {
  console.error('Usage: node gridscrape.js "<service> in <location>" [--outDir dir] [--max n]');
  process.exit(1);
}
const OUT_DIR = flagValues["--outDir"] ? path.resolve(flagValues["--outDir"]) : path.join(ROOT, "output");
const MAX_LEADS = parseInt(flagValues["--max"] || "0", 10) || 0;
const PROJECT = flagValues["--project"] || "";
const CONCURRENCY = parseInt(flagValues["--concurrency"] || "10", 10) || 10;
const MAX_PAGES_PER_TILE = parseInt(flagValues["--maxPagesPerTile"] || "5", 10) || 5;
const VIEW_DIST = 20000; // pb !1d viewport distance — proven value from the standalone project

// Same columns as scrape.cjs so enrich/audit/report/dashboard work unchanged.
const HEADERS = [
  "name", "category", "rating", "reviews", "website", "websiteText",
  "phone", "address", "plusCode", "hours", "imageUrls", "mapsUrl",
];
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvHeader = () => String.fromCharCode(0xfeff) + HEADERS.join(",") + "\r\n";
const csvRow = (row) => HEADERS.map((h) => csvEsc(row[h])).join(",") + "\r\n";

function slugify(q) {
  return (
    q.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "leads"
  );
}

// ---- query -> keyword + geocoded bbox -------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Business-level dedup key — MUST mirror web/lib/db.cjs#dedupKey so the scraper's
// unique count matches how the database dedupes leads. Chain listings that share a
// website/phone (e.g. KeyMe's many kiosks all on key.me) collapse to one business.
// This is what --max counts: N means N unique businesses, not N raw Maps results.
function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : "http://" + url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
function leadKey(p) {
  const domain = hostOf(p.website || "");
  if (domain) return "d:" + domain;
  const phone = String(p.phone || "").replace(/[^\d]/g, "");
  if (phone.length >= 7) return "p:" + phone;
  const name = String(p.name || "").trim().toLowerCase();
  const addr = String(p.address || "").trim().toLowerCase();
  if (name) return "n:" + name + "|" + addr;
  return "";
}

async function geocode(location, { strict = false } = {}) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=" +
    encodeURIComponent(location);
  const res = await fetch(url, {
    headers: { "User-Agent": "gmaps-scraper/1.0 (lead research tool)" },
  });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) return null;
  // strict = the location is a guess (trailing words of the query): only accept
  // real places/areas, never a random business or street that happens to match.
  const hit = arr.find(
    (r) => r.boundingbox && (!strict || r.category === "boundary" || r.category === "place")
  );
  if (!hit) return null;
  const [latMin, latMax, lngMin, lngMax] = hit.boundingbox.map(Number);
  return { latMin, latMax, lngMin, lngMax, display: hit.display_name || location };
}

// Work out keyword + area from the free-form query. Tries, in order:
//   1. "<service> in|near <location>"  (explicit, lenient geocode)
//   2. "<service>, <location>"         (comma form)
//   3. trailing 1-4 words as the location ("plumbers Lahore", "dentists New York")
// Returns { keyword, location, geo } or null when nothing geocodes.
async function resolveQuery(q) {
  const candidates = [];
  const m = /^(.*\S)\s+(?:in|near)\s+(\S.*)$/i.exec(q);
  if (m) candidates.push({ keyword: m[1].trim(), location: m[2].trim(), strict: false });
  const comma = q.indexOf(",");
  if (comma > 0) {
    candidates.push({
      keyword: q.slice(0, comma).trim(),
      location: q.slice(comma + 1).trim(),
      strict: false,
    });
  }
  const words = q.trim().split(/\s+/);
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) {
    candidates.push({
      keyword: words.slice(0, -k).join(" "),
      location: words.slice(-k).join(" "),
      strict: true,
    });
  }
  let first = true;
  for (const c of candidates) {
    if (!c.keyword || !c.location) continue;
    if (!first) await sleep(1100); // Nominatim usage policy: max 1 req/s
    first = false;
    let geo = null;
    try {
      geo = await geocode(c.location, { strict: c.strict });
    } catch (err) {
      console.warn(`  Geocode "${c.location}" failed: ${err.message}`);
    }
    if (geo) return { keyword: c.keyword, location: c.location, geo };
  }
  return null;
}

// Pad tiny city bboxes (Nominatim can return a near-point box) and pick grid
// steps so dense areas get fine tiles without huge regions exploding the
// request count.
function planGrid(bbox) {
  let { latMin, latMax, lngMin, lngMax } = bbox;
  const MIN_LAT_SPAN = 0.12, MIN_LNG_SPAN = 0.16; // ~13x15 km minimum coverage
  if (latMax - latMin < MIN_LAT_SPAN) {
    const c = (latMax + latMin) / 2;
    latMin = c - MIN_LAT_SPAN / 2; latMax = c + MIN_LAT_SPAN / 2;
  }
  if (lngMax - lngMin < MIN_LNG_SPAN) {
    const c = (lngMax + lngMin) / 2;
    lngMin = c - MIN_LNG_SPAN / 2; lngMax = c + MIN_LNG_SPAN / 2;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let latStep = clamp((latMax - latMin) / 6, 0.04, 0.3);
  let lngStep = clamp((lngMax - lngMin) / 6, 0.05, 0.45);
  // Cap total tiles (country-sized boxes): scale both steps up together.
  const tilesOf = () =>
    Math.ceil((latMax - latMin) / latStep) * Math.ceil((lngMax - lngMin) / lngStep);
  const MAX_TILES = 400;
  if (tilesOf() > MAX_TILES) {
    const k = Math.sqrt(tilesOf() / MAX_TILES);
    latStep *= k; lngStep *= k;
  }
  const centers = [];
  for (let lat = latMin + latStep / 2; lat < latMax; lat += latStep) {
    for (let lng = lngMin + lngStep / 2; lng < lngMax; lng += lngStep) {
      centers.push({ lat: +lat.toFixed(4), lng: +lng.toFixed(4) });
    }
  }
  return { bbox: { latMin, latMax, lngMin, lngMax }, centers };
}

// ---- Maps internal endpoint -------------------------------------------------------
const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, "pb-template.json"), "utf8"));

function buildUrl(keyword, lat, lng, offset) {
  const pb = tpl.pb
    .replace("{D}", String(VIEW_DIST))
    .replace("{LNG}", lng.toFixed(6))
    .replace("{LAT}", lat.toFixed(6))
    .replace("{OFFSET}", String(offset));
  return (
    "https://www.google.com/search?tbm=map&authuser=0&hl=en&gl=us" +
    "&pb=" + encodeURIComponent(pb) +
    "&q=" + encodeURIComponent(keyword)
  );
}

function parsePlaces(body) {
  const data = JSON.parse(body.replace(/^\)\]\}'\n?/, ""));
  const rows = data[64];
  if (!Array.isArray(rows)) return [];
  const places = [];
  for (const row of rows) {
    const d = row && row[1];
    if (!Array.isArray(d) || typeof d[11] !== "string") continue;
    places.push({
      name: d[11],
      category: (d[13] && d[13][0]) || "",
      phone: (d[178] && d[178][0] && d[178][0][0]) || "",
      website: (d[7] && d[7][0]) || "",
      address: d[39] || (Array.isArray(d[2]) ? d[2].join(", ") : ""),
      rating: (d[4] && d[4][7]) ?? "",
      reviews: (d[4] && (d[4][8] ?? (d[4][3] && d[4][3][1]))) ?? "",
      lat: d[9] && d[9][2],
      lng: d[9] && d[9][3],
      placeId: d[10] || "",
      mapsUrl: d[78] ? `https://www.google.com/maps/place/?q=place_id:${d[78]}` : "",
    });
  }
  return places;
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---- main ---------------------------------------------------------------------------
(async () => {
  const parts = await resolveQuery(QUERY);
  if (!parts) {
    console.error(`Could not find a location in "${QUERY}" — try "<service> in <city>". Falling back is up to the caller.`);
    process.exit(3);
  }
  const geo = parts.geo;
  console.log(`  Query: "${parts.keyword}" | Location: "${parts.location}"`);
  console.log(`  Area: ${geo.display}`);

  // Admin-managed proxy pool: each Maps tile request picks a random proxy so the
  // scrape spreads across IPs instead of hammering one. Empty list = direct.
  const proxyUrls = await proxy.loadProxyUrls();
  console.log(`  Proxies: ${proxyUrls.length ? `${proxyUrls.length} (random per request)` : "none (direct)"}`);

  const { bbox, centers } = planGrid(geo);
  console.log(
    `  Grid: ${centers.length} tiles over [${bbox.latMin.toFixed(3)},${bbox.lngMin.toFixed(3)}] .. [${bbox.latMax.toFixed(3)},${bbox.lngMax.toFixed(3)}]`
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(OUT_DIR, `${slugify(QUERY)}-${stamp}.csv`);
  fs.writeFileSync(outFile, csvHeader(), "utf8"); // header up front: dashboard sees the file immediately
  console.log(`  Output: ${outFile}`);

  // Optional realtime DB upserts (project runs only — standalone CLI use skips it).
  // Per-tenant: the owning user id is passed to the runner via GMAPS_USER_ID.
  const OWNER_ID = process.env.GMAPS_USER_ID || null;
  let db = null;
  let store = null;
  if (PROJECT && OWNER_ID) {
    try {
      db = require("./web/lib/db.cjs");
      // Optional: record the running new-vs-duplicate split into project state so the
      // dashboard can show what was charged. Best-effort — never block scraping on it.
      try { store = require("./web/lib/store.cjs"); } catch {}
    } catch (err) {
      console.warn(`  DB unavailable (${err.message}) — CSV only`);
    }
  } else if (PROJECT && !OWNER_ID) {
    console.warn("  DB skipped: no GMAPS_USER_ID owner set — CSV only");
  }
  let pendingDb = [];
  let flushing = false;
  let dbInserted = 0; // cumulative leads new to the account (charged) this run
  let dbUpdated = 0; // cumulative duplicates merged for free this run
  async function flushDb(force = false) {
    if (!db || flushing || (!force && pendingDb.length < 20) || !pendingDb.length) return;
    flushing = true;
    const batch = pendingDb;
    pendingDb = [];
    try {
      const res = await db.upsertLeads(OWNER_ID, batch);
      dbInserted += res.inserted;
      dbUpdated += res.updated;
      console.log(`  DB: +${res.inserted} new, ${res.updated} updated (total ${seenKeys.size})`);
      if (store) {
        try {
          store.writeState(OUT_DIR, { dbSync: { inserted: dbInserted, updated: dbUpdated, at: new Date().toISOString() } });
        } catch {}
      }
    } catch (err) {
      console.warn(`  DB upsert failed: ${err.message}`);
    } finally {
      flushing = false;
    }
  }
  const dbTimer = db ? setInterval(() => flushDb(true), 2500) : null;

  const seen = new Set(); // placeIds — cheap per-listing dedup (one Maps result)
  const seenKeys = new Set(); // business dedup keys — what --max counts (mirrors DB)
  let requestsDone = 0;
  let blocked = 0;
  let tilesDone = 0;
  let stopped = false;

  function recordFresh(places) {
    const rows = [];
    for (const p of places) {
      if (!p.placeId || seen.has(p.placeId)) continue;
      if (
        p.lat < bbox.latMin - 0.05 || p.lat > bbox.latMax + 0.05 ||
        p.lng < bbox.lngMin - 0.05 || p.lng > bbox.lngMax + 0.05
      ) continue;
      seen.add(p.placeId); // this Maps listing is now processed
      // Collapse chain listings that resolve to the same business (KeyMe's kiosks
      // all share key.me): record only the first per dedup key, and count --max by
      // unique businesses so "30" yields 30 distinct leads, not 30 raw rows.
      const key = leadKey(p) || ("pid:" + p.placeId);
      if (seenKeys.has(key)) continue;
      if (MAX_LEADS && seenKeys.size >= MAX_LEADS) { stopped = true; break; }
      seenKeys.add(key);
      rows.push(p);
    }
    if (!rows.length) return 0;
    fs.appendFileSync(
      outFile,
      rows
        .map((p) =>
          csvRow({
            ...p,
            websiteText: "",
            plusCode: "",
            hours: "",
            imageUrls: "",
          })
        )
        .join(""),
      "utf8"
    );
    if (db) {
      pendingDb.push(...rows.map((p) => ({ ...p, project: PROJECT, query: QUERY })));
      flushDb();
    }
    return rows.length;
  }

  const queue = centers.map(({ lat, lng }) => ({ lat, lng, offset: 0 }));

  async function fetchTile(task) {
    const url = buildUrl(parts.keyword, task.lat, task.lng, task.offset);
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        // New random proxy each attempt — a blocked/dead proxy just fails over.
        const dispatcher = proxy.proxyDispatcher(proxy.pickRandom(proxyUrls));
        const res = await fetch(url, {
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(30000),
          ...(dispatcher ? { dispatcher } : {}),
        });
        const text = await res.text();
        if (!text.startsWith(")]}'")) throw new Error("unexpected response (block/captcha?)");
        return text;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  async function handleTask(task) {
    let text;
    try {
      text = await fetchTile(task);
    } catch (err) {
      blocked++;
      console.warn(`  tile(${task.lat},${task.lng}) page=${task.offset / 20} failed: ${err.message}`);
      // All-blocked early abort: template expired or Google is rate limiting.
      if (blocked >= 8 && seenKeys.size === 0) {
        stopped = true;
        throw new Error("Every request is blocked — pb template likely expired (run: node bootstrap-pb.js)");
      }
      return;
    }
    requestsDone++;
    const places = parsePlaces(text);
    const fresh = recordFresh(places);
    if (task.offset === 0) tilesDone++;
    console.log(
      `  tile(${task.lat},${task.lng}) page=${task.offset / 20} got=${places.length} new=${fresh} | leads=${seenKeys.size} tiles=${tilesDone}/${centers.length}`
    );
    // Paginate while pages come back full AND still yield new places.
    if (!stopped && places.length === 20 && fresh > 0 && task.offset / 20 + 1 < MAX_PAGES_PER_TILE) {
      queue.push({ lat: task.lat, lng: task.lng, offset: task.offset + 20 });
    }
  }

  // Tiny worker pool — no crawlee dependency needed for plain GETs.
  let fatal = null;
  await new Promise((resolve) => {
    let active = 0;
    const next = () => {
      if (fatal || (queue.length === 0 && active === 0) || (stopped && active === 0)) return resolve();
      while (active < CONCURRENCY && queue.length && !stopped && !fatal) {
        const task = queue.shift();
        active++;
        handleTask(task)
          .catch((err) => { fatal = err; })
          .finally(() => { active--; next(); });
      }
      if (active === 0 && (queue.length === 0 || stopped)) resolve();
    };
    next();
  });

  if (dbTimer) clearInterval(dbTimer);
  await flushDb(true);
  if (fatal) {
    console.error(`\nFATAL: ${fatal.message}`);
    process.exit(1);
  }

  console.log(`\n  Finished. ${seenKeys.size} leads saved to:\n  ${outFile}\n`);
  console.log(`  (${requestsDone} requests, ${blocked} failed${MAX_LEADS && seenKeys.size >= MAX_LEADS ? ", max reached" : ""})`);
})().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
