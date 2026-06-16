#!/usr/bin/env node
// Fast Google Maps lead scraper (patchright / stealth Chrome).
// Usage:
//   node scrape.js "real estate agency miami"
//   node scrape.js "https://www.google.com/maps/search/real+estate+agency+miami"
//   node scrape.js "dentists in austin" --max 100 --headless
//   node scrape.js "dentists in austin" --blockCanvas    # skip map rendering (saves CPU/GPU)
//   node scrape.js "dentists in austin" --cookies ./gmail-cookies.json
//   node scrape.js "dentists in austin" --network        # fast: read leads off the Maps RPC
//
// Output: ./output/<slug>-<timestamp>.csv  (rows in scrape order: first captured = top row)
//
// Capture modes:
//   (default) DOM   - click each result card, read the side panel. Most resilient,
//                     but ~1.7s/lead and slows as the list grows.
//   --network       - decode the "/search?tbm=map" responses (~20 detailed places
//                     per scroll, no clicking). Much faster and stays flat. Misses
//                     plusCode (not in the RPC). --dom forces the legacy path.

const fs = require("fs");
const path = require("path");
const { chromium } = require("patchright");
const { startCapture } = require("./inpage.cjs");
const { rowsFromBody } = require("./mapsparse.cjs");
const proxy = require("./web/lib/proxy.cjs");

// ---- CLI args ----------------------------------------------------------------
// Flags that take a value (so the value isn't mistaken for a positional query word).
const VALUE_FLAGS = new Set([
  "--max",
  "--clickDelay",
  "--closeDelay",
  "--scrollDelay",
  "--scrollAmount",
  "--maxNoCardRounds",
  "--outDir",
  "--profileDir",
  "--cookies",
  "--viewportWidth",
  "--viewportHeight",
]);

const rawArgs = process.argv.slice(2);
const flags = new Set();
const flagValues = {};
const positionals = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith("--")) {
    flags.add(a);
    if (VALUE_FLAGS.has(a) && rawArgs[i + 1] !== undefined && !rawArgs[i + 1].startsWith("--")) {
      flagValues[a] = rawArgs[++i]; // consume the value
    }
  } else {
    positionals.push(a);
  }
}

function flagValue(name, fallback) {
  return flagValues[name] !== undefined ? flagValues[name] : fallback;
}

const query = positionals.join(" ").trim() || "real estate agency miami";
const maxLeads = parseInt(flagValue("--max", "0"), 10) || 0; // 0 = unlimited
const headless = flags.has("--headless");
const blockImages = !flags.has("--allowImages");
// --blockCanvas disables the GPU/WebGL/2D-canvas pipeline so Chrome never paints
// the map pane. The results feed and the network RPC are DOM/HTTP and unaffected,
// so this is a big CPU/GPU saving on long runs (especially on a headless server)
// at the cost of a blank map you don't read from anyway.
const blockCanvas = flags.has("--blockCanvas");
// Network mode reads leads straight off the Maps "/search?tbm=map" RPC responses
// (~20 detailed places per scroll, no per-card clicking) — much faster and it
// doesn't slow down as the result set grows. --dom forces the legacy click path.
const useNetwork = flags.has("--network") && !flags.has("--dom");
const viewportWidth = parsePositiveInt(flagValue("--viewportWidth", "1920"), 1920);
const viewportHeight = parsePositiveInt(flagValue("--viewportHeight", "1080"), 1080);

// In-page pacing. Defaults match the spec; tune via flags if needed.
const CONFIG = {
  clickDelay: parseInt(flagValue("--clickDelay", "1200"), 10),
  closeDelay: parseInt(flagValue("--closeDelay", "500"), 10),
  scrollDelay: parseInt(flagValue("--scrollDelay", "500"), 10),
  scrollAmount: parseInt(flagValue("--scrollAmount", "1000"), 10),
  maxNoCardRounds: parseInt(flagValue("--maxNoCardRounds", "12"), 10),
  maxLeads,
};

const HEADERS = [
  "name",
  "category",
  "rating",
  "reviews",
  "website",
  "websiteText",
  "phone",
  "address",
  "plusCode",
  "hours",
  "imageUrls",
  "mapsUrl",
];

// ---- helpers -----------------------------------------------------------------
function buildUrl(q) {
  if (/^https?:\/\//i.test(q)) return q;
  return "https://www.google.com/maps/search/" + encodeURIComponent(q).replace(/%20/g, "+");
}

function slugify(q) {
  return (
    q
      .replace(/^https?:\/\/[^/]+\/maps\/search\//i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "leads"
  );
}

const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
// UTF-8 BOM + header, written once. Rows are appended individually (O(1) each)
// so a long run never rebuilds the whole CSV — keeps writes fast as leads grow.
const csvHeader = () => String.fromCharCode(0xfeff) + HEADERS.join(",") + "\r\n";
const csvRow = (row) => HEADERS.map((h) => csvEsc(row[h])).join(",") + "\r\n";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadCookies(file) {
  if (!file) return [];
  const resolved = path.resolve(file);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;
  if (!Array.isArray(cookies)) {
    throw new Error(`Cookie file must contain an array or {"cookies": [...]}: ${resolved}`);
  }
  return cookies.map(normalizeCookie).filter(Boolean);
}

function normalizeCookie(cookie) {
  if (!cookie || cookie.name === undefined || cookie.value === undefined) return null;
  const normalized = {
    name: String(cookie.name),
    value: String(cookie.value),
    path: cookie.path || "/",
  };

  if (cookie.url) normalized.url = cookie.url;
  else if (cookie.domain) normalized.domain = cookie.domain;
  else normalized.url = "https://www.google.com";

  if (cookie.expires !== undefined || cookie.expirationDate !== undefined) {
    const expires = Number(cookie.expires ?? cookie.expirationDate);
    if (Number.isFinite(expires) && expires > 0) normalized.expires = Math.floor(expires);
  }
  if (cookie.httpOnly !== undefined) normalized.httpOnly = !!cookie.httpOnly;
  if (cookie.secure !== undefined) normalized.secure = !!cookie.secure;

  const sameSite = String(cookie.sameSite || "").toLowerCase().replace(/[_\s-]/g, "");
  if (sameSite === "strict") normalized.sameSite = "Strict";
  else if (sameSite === "lax") normalized.sameSite = "Lax";
  else if (sameSite === "none" || sameSite === "no_restriction" || sameSite === "norestriction") {
    normalized.sameSite = "None";
    normalized.secure = true;
  }

  return normalized;
}

// ---- main --------------------------------------------------------------------
(async () => {
  const url = buildUrl(query);
  // --outDir lets a project run drop the CSV straight into output/projects/<name>/.
  const outDir = flagValues["--outDir"]
    ? path.resolve(flagValues["--outDir"])
    : path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(outDir, `${slugify(query)}-${stamp}.csv`);

  // Persistent profile keeps Google "warm" (cookies/consent) across runs -> faster, less friction.
  // The web UI passes a per-project profile so browser cleanup never touches other automation.
  const userDataDir = flagValues["--profileDir"]
    ? path.resolve(flagValues["--profileDir"])
    : path.join(__dirname, ".chrome-profile");
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`\n  Query : ${query}`);
  console.log(`  URL   : ${url}`);
  console.log(`  Output: ${outFile}`);
  console.log(`  Max   : ${maxLeads || "unlimited"}`);
  console.log(`  View  : ${viewportWidth}x${viewportHeight} ${headless ? "headless" : "headful"}`);
  console.log(`  Images: ${blockImages ? "blocked" : "allowed"}`);
  console.log(`  Canvas: ${blockCanvas ? "blocked (no map render)" : "rendered"}\n`);

  // Spec config: real Chrome channel, no fingerprint injection, no custom UA/headers.
  // This matches the original (most stable) launch: a 1920x1080 viewport plus a
  // maximized window so the results feed AND the side panel stay visible together
  // (clicking a result opens the panel in place instead of navigating to the
  // place-only page and losing the list). --disable-dev-shm-usage is a no-op on
  // Windows and prevents Chrome's small /dev/shm from filling up on Linux long runs.
  // One random proxy from the admin pool for this scrape (browsers can't rotate
  // per-request). Empty pool = direct connection.
  const pwProxy = await proxy.randomPlaywrightProxy();
  console.log(`  Proxy : ${pwProxy ? pwProxy.server : "none (direct)"}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless,
    viewport: { width: viewportWidth, height: viewportHeight },
    ...(pwProxy ? { proxy: pwProxy } : {}),
    args: [
      `--window-size=${viewportWidth},${viewportHeight}`,
      "--start-maximized",
      "--disable-dev-shm-usage",
      // Kill the map renderer when asked: --disable-webgl makes the WebGL map fall
      // back gracefully (no crash), and the GPU/2D-canvas flags drop the rest of
      // the painting cost. Feed + RPC capture keep working.
      ...(blockCanvas
        ? ["--disable-webgl", "--disable-accelerated-2d-canvas", "--disable-gpu"]
        : []),
    ],
  });

  // The Chrome flags above only disable GPU acceleration — Chrome then falls back
  // to software rendering (SwiftShader) and the WebGL map still burns CPU drawing
  // every frame. So inside the page we make getContext("webgl"/"webgl2") return
  // null: Maps detects "no WebGL" and falls back to its cheap raster mode, whose
  // tile images the routing below never lets through — net result, nothing paints.
  // 2D canvas must stay alive: nulling it too makes Maps bail out before it ever
  // renders the results feed (verified: feed never appears, 0 leads).
  if (blockCanvas) {
    await context.addInitScript(() => {
      const block = (proto) => {
        const orig = proto.getContext;
        Object.defineProperty(proto, "getContext", {
          value: function (type, ...rest) {
            if (/webgl/i.test(String(type))) return null;
            return orig.call(this, type, ...rest);
          },
          configurable: true,
        });
      };
      block(HTMLCanvasElement.prototype);
      if (typeof OffscreenCanvas !== "undefined") block(OffscreenCanvas.prototype);
    });
  }

  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: viewportWidth, height: viewportHeight }).catch(() => {});

  if (blockImages || blockCanvas) {
    await context.route("**/*", (route) => {
      const req = route.request();
      const type = req.resourceType();
      if (blockImages && (type === "image" || type === "media" || type === "font")) {
        return route.abort();
      }
      // Map tiles arrive as fetch/xhr in vector mode (not resourceType "image"),
      // so also cut them at the network — no point downloading data for a canvas
      // that can't paint.
      if (blockCanvas && /\/maps\/vt[/?]/.test(req.url())) return route.abort();
      return route.continue();
    });
  }

  // Pre-seed Google's consent cookie so EU/datacenter IPs never get redirected
  // to the full-page consent.google.com wall (which has no results feed and used
  // to dead-end the scrape with 0 leads on the VPS). Harmless elsewhere. Seeded
  // before the account cookies so a real account's own SOCS wins if present.
  await context
    .addCookies([
      {
        name: "SOCS",
        value: "CAISHAgBEhJnd3NfMjAyNDAxMDktMF9SQzIaAmRlIAEaBgiA_LyaBg",
        domain: ".google.com",
        path: "/",
      },
      { name: "CONSENT", value: "PENDING+987", domain: ".google.com", path: "/" },
    ])
    .catch(() => {});

  const cookieFile = flagValue("--cookies", "");
  if (cookieFile) {
    const cookies = loadCookies(cookieFile);
    if (cookies.length) await context.addCookies(cookies);
    console.log(`  Cookies: loaded ${cookies.length} from ${path.resolve(cookieFile)}`);
  } else {
    console.log("  Cookies: none");
  }

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Handle Google consent screen if it appears (EU/first run).
  await dismissConsent(page);

  // Wait for the results feed to exist.
  try {
    await page.waitForSelector('div[role="feed"]', { timeout: 30000 });
  } catch {
    console.warn(
      "  Results feed not found. If a consent/login page is showing, accept it in the window, then re-run."
    );
  }

  // ---- Network capture mode --------------------------------------------------
  if (useNetwork) {
    fs.writeFileSync(outFile, csvHeader(), "utf8");
    const { written, reason } = await runNetworkCapture(page, outFile);
    // The RPC only fires when scrolling loads MORE results. Small result sets
    // (e.g. a thin region) ship entirely with the initial page, so the listener
    // never sees a response and we'd report 0 — even with results on screen.
    // In that case fall through to the DOM click path for the visible cards.
    const visibleCards = await page
      .locator('div[role="feed"] a[href*="/maps/place/"]')
      .count()
      .catch(() => 0);
    let total = written;
    let finalReason = reason;
    if (written === 0 && visibleCards > 0) {
      console.log(`\n  Network capture saw no RPC but ${visibleCards} result(s) are on screen — reading the visible cards.`);
      let rows = await captureFeedCards(page);
      if (CONFIG.maxLeads) rows = rows.slice(0, CONFIG.maxLeads);
      if (rows.length) fs.appendFileSync(outFile, rows.map(csvRow).join(""), "utf8");
      total = rows.length;
      finalReason = `${reason || "n/a"} (card fallback)`;
    }
    console.log(`\n\n  Exit reason: ${finalReason || "n/a"}`);
    console.log(`  Finished. ${total} leads saved to:\n  ${outFile}\n`);
    await context.close();
    process.exit(0);
  }

  // Surface in-page progress to the terminal.
  page.on("console", (msg) => {
    const t = msg.text();
    if (/^Captured #|^Done\.|Reached end/.test(t)) console.log("   " + t);
  });

  // Inject + start the click/capture/remove loop (non-blocking), then poll progress.
  await page.evaluate(startCapture, CONFIG);

  fs.writeFileSync(outFile, csvHeader(), "utf8"); // header once

  let written = 0;
  let reason = "";
  let done = false;
  while (!done) {
    await sleep(1200);
    let state;
    try {
      // DRAIN the captured leads each tick: __drainLeads() returns the new rows
      // AND clears the in-page buffer, so the page's memory footprint stays flat
      // no matter how many thousands of leads we capture (the running total is
      // tracked separately in __MAPS_TOTAL). This is the key to the browser not
      // slowing down / ballooning on long runs.
      state = await page.evaluate(() => ({
        fresh: window.__drainLeads ? window.__drainLeads() : [],
        done: !!window.__MAPS_DONE,
        reason: window.__MAPS_EXIT_REASON || "",
      }));
    } catch {
      break; // page navigated/closed
    }

    if (state.fresh.length) {
      fs.appendFileSync(outFile, state.fresh.map(csvRow).join(""), "utf8");
      written += state.fresh.length;
      process.stdout.write(`\r  Captured ${written} leads...   `);
    }
    reason = state.reason || reason;
    done = state.done;
  }

  // Final flush of any stragglers captured between the last poll and completion.
  const tail = await page
    .evaluate(() => (window.__drainLeads ? window.__drainLeads() : []))
    .catch(() => []);
  if (tail.length) {
    fs.appendFileSync(outFile, tail.map(csvRow).join(""), "utf8");
    written += tail.length;
  }

  console.log(`\n\n  Exit reason: ${reason || "n/a"}`);
  console.log(`  Finished. ${written} leads saved to:\n  ${outFile}\n`);

  await context.close();
  process.exit(0);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});

// Last-resort extraction for tiny result sets: parse the visible feed cards
// directly (no clicking — the 2026-06 Maps UI opens place panels collapsed, so
// the click path can't read them). Cards carry name, rating(reviews),
// "category · address", an hours line with the phone, and sometimes a website
// action link — less complete than the RPC rows but far better than 0 leads.
async function captureFeedCards(page) {
  return page
    .evaluate(() => {
      const clean = (v) =>
        String(v || "")
          .replace(/[\uE000-\uF8FF\uFE00-\uFE0F]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [];
      return [...feed.querySelectorAll('div[role="article"]')]
        .filter((card) => card.querySelector('a[href*="/maps/place/"]'))
        .map((card) => {
          const link = card.querySelector('a[href*="/maps/place/"]');
          const name = clean(card.getAttribute("aria-label") || link.getAttribute("aria-label"));
          const lines = (card.innerText || "").split("\n").map(clean).filter(Boolean);
          const ratingLine = lines.find((l) => /^\d(\.\d)?\(/.test(l)) || "";
          const rating = ratingLine.match(/^([\d.]+)/)?.[1] || "";
          const reviews = ratingLine.match(/\(([\d,]+)\)/)?.[1]?.replace(/,/g, "") || "";
          // "Category · Address" line: has the separator and isn't the hours line
          const catLine = lines.find((l) => l !== name && !/^\d/.test(l) && !/^(Open|Closed|Opens|Temporarily|Permanently)\b/i.test(l) && !l.startsWith('"')) || "";
          const [category = "", address = ""] = catLine.split(" · ").map(clean);
          const phone = (card.innerText.match(/\+?\d[\d\s().-]{8,18}\d/) || [""])[0].trim();
          const websiteEl = [...card.querySelectorAll("a[href]")].find(
            (a) => !a.href.includes("google.com/maps") && /^https?:/.test(a.href)
          );
          return {
            name,
            category,
            rating,
            reviews,
            website: websiteEl?.href || "",
            websiteText: "",
            phone,
            address,
            plusCode: "",
            hours: "",
            imageUrls: "",
            mapsUrl: link?.href || location.href,
          };
        })
        .filter((r) => r.name);
    })
    .catch(() => []);
}

// Read leads off the Maps search RPC. We listen for every "/search?tbm=map"
// response, decode it, and stream new (deduped) rows to the CSV — then scroll the
// feed to make Google fetch the next batch. No per-card clicking, so throughput
// stays flat instead of degrading as the result set grows.
async function runNetworkCapture(page, outFile) {
  const seen = new Set(); // place key (cid/place id) -> dedup across batches
  const seenNames = new Set(); // lowercased names, for the visible-card sweep below
  let pending = []; // rows decoded but not yet flushed to CSV
  let decodeErrors = 0;

  page.on("response", async (res) => {
    const u = res.url();
    if (!/\/search\?tbm=map/.test(u)) return;
    let body;
    try {
      body = await res.text();
    } catch {
      return; // response body already gone (navigation)
    }
    let parsed;
    try {
      parsed = rowsFromBody(body);
    } catch {
      decodeErrors++;
      return;
    }
    for (let i = 0; i < parsed.rows.length; i++) {
      const key = parsed.keys[i] || parsed.rows[i].name;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      if (parsed.rows[i].name) seenNames.add(parsed.rows[i].name.toLowerCase());
      pending.push(parsed.rows[i]);
    }
  });

  // Google's lazy-loader ignores programmatic scrolling (feed.scrollTop /
  // scrollBy dispatch untrusted events it filters out) — which is why a run
  // stalls until someone scrolls the list by hand. page.mouse.wheel() sends
  // trusted wheel input through CDP, indistinguishable from hand-scrolling,
  // so the next-batch fetch fires every time (headless included). The cursor
  // must be over the feed for the wheel to land on it.
  const moveMouseOverFeed = async () => {
    try {
      const box = await page.locator('div[role="feed"]').boundingBox({ timeout: 2000 });
      if (!box || !box.width) return false;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      return true;
    } catch {
      return false;
    }
  };

  // Jump straight to the bottom (instant positioning, no matter how tall the
  // feed is), then fire a few trusted wheel ticks — the ticks are what arm the
  // next fetch. Leads come from the RPC, not the DOM, so before scrolling we
  // prune all but the newest cards out of the feed — otherwise the DOM grows
  // unbounded and every layout/scroll pass gets slower the longer the run.
  // Returns the cumulative card count (pruned + still rendered) so the caller
  // can tell whether the list is still actually growing (vs. a round where
  // every place was a dedup).
  const KEEP_CARDS = 30;
  const scrollFeed = async () => {
    if (!(await moveMouseOverFeed())) return { ok: false, total: 0 };
    const total = await page
      .evaluate((keep) => {
        const feed = document.querySelector('div[role="feed"]');
        if (!feed) return null;
        window.__gmPruned = window.__gmPruned || 0;
        const cards = Array.from(feed.children).filter((el) =>
          el.querySelector('a[href*="/maps/place/"]')
        );
        if (cards.length > keep) {
          // Drop everything (cards + separator divs) before the first card we
          // keep; Google only ever appends, so it never touches them again.
          const cutoff = cards[cards.length - keep];
          while (feed.firstElementChild && feed.firstElementChild !== cutoff) {
            feed.firstElementChild.remove();
          }
          window.__gmPruned += cards.length - keep;
        }
        feed.scrollTop = feed.scrollHeight;
        return window.__gmPruned + Math.min(cards.length, keep);
      }, KEEP_CARDS)
      .catch(() => null);
    if (total === null) return { ok: false, total: 0 };
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 800).catch(() => {});
      await sleep(80);
    }
    return { ok: true, total };
  };

  // Re-arm a stalled lazy-loader: trusted wheel up a couple screens, then the
  // next loop iteration snaps back to the bottom and wheels down again.
  const jiggleFeed = async () => {
    await moveMouseOverFeed();
    await page.mouse.wheel(0, -2000).catch(() => {});
  };

  const feedHasEnd = () =>
    page
      .evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        return !!feed && feed.textContent.includes("You've reached the end of the list");
      })
      .catch(() => false);

  let written = 0;
  const cap = CONFIG.maxLeads || Infinity;
  const flush = () => {
    if (!pending.length) return 0;
    const room = cap - written;
    if (room <= 0) return 0;
    const batch = pending.splice(0, Math.min(pending.length, room));
    fs.appendFileSync(outFile, batch.map(csvRow).join(""), "utf8");
    return batch.length;
  };

  // The first batch arrives with the page load; give it a moment to land.
  await sleep(1500);
  written += flush();
  if (written) process.stdout.write(`\r  Captured ${written} leads...   `);

  let reason = "completed";
  let noGrowthRounds = 0;
  // Be generous before declaring the list exhausted: Google often pauses for a
  // beat between batches, and a stalled loader usually restarts after a jiggle.
  const MAX_NO_GROWTH = Math.max(CONFIG.maxNoCardRounds, 15);
  let lastTotal = 0;

  while (true) {
    if (CONFIG.maxLeads && written >= CONFIG.maxLeads) {
      reason = "max leads reached";
      break;
    }
    const { ok, total } = await scrollFeed();
    if (!ok) {
      reason = "results feed gone";
      break;
    }
    // Let the next RPC batch arrive + decode. The wheel ticks above already add
    // ~240ms, so this stays shorter than the old fixed wait.
    await sleep(CONFIG.scrollDelay + 250);

    const added = flush();
    // More cumulative cards means Google rendered more results — progress, even if
    // this round's RPC places were all dedups. Only count a round as "dead" when
    // nothing was written AND the feed didn't grow.
    const grew = total > lastTotal;
    if (total > lastTotal) lastTotal = total;

    if (added) {
      written += added;
      process.stdout.write(`\r  Captured ${written} leads...   `);
      noGrowthRounds = 0;
    } else if (grew) {
      noGrowthRounds = 0;
    } else {
      noGrowthRounds++;
      // Stay pinned at the bottom and just wait — Google usually delivers the next
      // batch after a short pause. Only re-arm with an up-jiggle once it's clearly
      // stalled (every 3rd dead round), so the feed doesn't thrash up and down.
      if (noGrowthRounds % 3 === 0) {
        await jiggleFeed();
        await sleep(400);
      } else {
        await sleep(300);
      }
    }

    if (await feedHasEnd()) {
      written += flush();
      reason = "reached end of list";
      break;
    }
    if (noGrowthRounds >= MAX_NO_GROWTH) {
      reason = "no new leads after scrolling";
      break;
    }
  }

  // Response bodies can still be decoding when the loop breaks (the handler is
  // async, and a loaded VPS decodes slowly) — give in-flight batches a moment to
  // land before the final flush instead of silently dropping them.
  await sleep(2000);
  written += flush();

  // Sweep the still-rendered feed cards for places the RPC never delivered —
  // most often the initial batch that ships inline with the page HTML rather
  // than over the RPC. Card rows are less complete than RPC rows, but a partial
  // lead beats a missing one.
  if (written < cap && reason !== "results feed gone") {
    const cards = await captureFeedCards(page);
    const extra = cards
      .filter((r) => r.name && !seenNames.has(r.name.toLowerCase()))
      .slice(0, cap - written);
    if (extra.length) {
      fs.appendFileSync(outFile, extra.map(csvRow).join(""), "utf8");
      written += extra.length;
      console.log(`\n  Recovered ${extra.length} lead(s) from visible cards the RPC never delivered.`);
    }
  }
  if (decodeErrors) console.log(`\n  Warning: ${decodeErrors} RPC batch(es) failed to decode.`);

  if (CONFIG.maxLeads && written > CONFIG.maxLeads) written = CONFIG.maxLeads; // report cap honestly
  return { written, reason };
}

async function dismissConsent(page) {
  const tryClick = async (frame) => {
    const selectors = [
      'button[aria-label="Accept all"]',
      'button[aria-label="Reject all"]',
      'form[action*="consent"] button',
      'button:has-text("Accept all")',
      'button:has-text("Reject all")',
      'button:has-text("I agree")',
      // consent.google.com localizes button text by IP-geo (e.g. German on the VPS)
      'button:has-text("Alle akzeptieren")',
      'button:has-text("Alle ablehnen")',
    ];
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await el.click({ timeout: 3000 });
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          return true;
        }
      } catch {}
    }
    return false;
  };

  if (await tryClick(page)) return;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (await tryClick(frame)) return;
  }
}
