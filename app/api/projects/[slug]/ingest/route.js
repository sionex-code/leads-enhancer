import path from "path";
import fs from "fs";
import store from "../../../../../web/lib/store.cjs";
import db from "../../../../../web/lib/db.cjs";
import billing from "../../../../../web/lib/billing.cjs";
import queue from "../../../../../web/lib/queue.cjs";
import warehousePublish from "../../../../../web/lib/warehouse-publish.cjs";
import publicSearches from "../../../../../web/lib/public-searches.cjs";
import { haversineKm } from "../../../../../web/lib/geo-distance.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Hard ceiling per ingest call, independent of what the client claims to have
// scraped. The extension runs on the user's machine, so its output is
// untrusted input — every limit that guards /api/projects/find has to be
// re-applied here or the extension path would be a way around them.
const MAX_ROWS_PER_INGEST = 1000;

const SOCIAL_KEYS = [
  "facebook", "instagram", "linkedin", "twitter",
  "youtube", "tiktok", "pinterest", "whatsapp", "telegram",
];

const CSV_HEADERS = [
  "name", "category", "rating", "reviews", "website", "phone", "address",
  "plus_code", "hours", "maps_url", "lat", "lng",
  "email", "all_emails", "contact_page",
  ...SOCIAL_KEYS,
  "owner_replied", "owner_reply_count",
  "whatsapp_status", "whatsapp_id", "enrich_status",
];

function csvField(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(rows) {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) lines.push(CSV_HEADERS.map((h) => csvField(r[h])).join(","));
  return lines.join("\n");
}

const str = (v) => (v == null ? "" : String(v));
const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Map one extension row onto the lead shape db.upsertLeads expects — the same
// shape warehouse.toLeadRow produces, so an extension-sourced lead is
// indistinguishable downstream from a warehouse-sourced one.
function toLeadRow(x, ctx) {
  const row = {
    name: str(x.name),
    category: str(x.category),
    rating: x.rating != null ? String(x.rating) : "",
    reviews: x.reviews != null ? String(x.reviews) : "",
    website: str(x.website),
    phone: str(x.phone),
    address: str(x.address),
    // The extension doesn't read the place detail panel, so these stay blank
    // rather than being invented; the warehouse fills them when it has them.
    plus_code: "",
    hours: "",
    maps_url: str(x.maps_url || x.mapsUrl),
    lat: numOrNull(x.lat),
    lng: numOrNull(x.lng),
    email: str(x.email),
    all_emails: str(x.all_emails || x.emails_all || x.allEmails),
    contact_page: str(x.contact_page || x.contactPage),
    owner_replied: numOrNull(x.owner_replied),
    owner_reply_count: numOrNull(x.owner_reply_count),
    project: ctx.project,
    query: ctx.query,
  };
  for (const k of SOCIAL_KEYS) row[k] = str(x[k]);
  return row;
}

// Hold the scrape to the area that was asked for.
//
// The warehouse path has always done this — a bounding-box query refined with
// haversine — so a warehouse search respects the slider exactly. The live path
// did not, and could not: the radius was sent to the extension and then
// forgotten, never written to the project, so nothing downstream knew what it
// had been.
//
// It matters because the extension only over-approximates. It turns centre plus
// radius into a *square* bbox and keeps anything inside it plus a fixed 0.05
// degree margin, and Google Maps answers the query text rather than our area, so
// a brand name pulls in branches from the whole country. At 5 km that accepts
// results ~14 km out; at 1 km, ~9 km. The slider was decoration.
//
// Returns null when the project records no area, so an older project ingests
// exactly as it did before.
function areaFilterFor(meta) {
  const lat = Number(meta.searchCenterLat);
  const lng = Number(meta.searchCenterLng);
  const radiusKm = Number(meta.searchRadiusKm);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusKm) && radiusKm > 0) {
    return (row) => {
      const rLat = Number(row.lat);
      const rLng = Number(row.lng);
      // A row with no coordinates cannot be proven outside, and dropping it
      // would lose a real lead over missing metadata. Keep it.
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) return true;
      return haversineKm(lat, lng, rLat, rLng) <= radiusKm;
    };
  }
  if (meta.searchBbox) {
    try {
      const b = JSON.parse(meta.searchBbox);
      if (["latMin", "latMax", "lngMin", "lngMax"].every((k) => Number.isFinite(Number(b[k])))) {
        return (row) => {
          const rLat = Number(row.lat);
          const rLng = Number(row.lng);
          if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) return true;
          return rLat >= b.latMin && rLat <= b.latMax && rLng >= b.lngMin && rLng <= b.lngMax;
        };
      }
    } catch {
      // A malformed area is not a reason to reject the leads.
    }
  }
  return null;
}

// POST /api/projects/:slug/ingest
// Accepts leads scraped by the browser extension and stores them exactly as a
// warehouse-backed find would.
export async function POST(request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const { slug } = await params;
  if (!slug) return Response.json({ error: "Missing project" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body?.rows) ? body.rows : null;
  if (!incoming) return Response.json({ error: "rows[] is required" }, { status: 400 });

  // The project must already exist and belong to this user — safeProjectDir
  // scopes to the tenant, so a foreign slug can't be written into.
  const dir = store.safeProjectDir(slug, userId);
  if (!fs.existsSync(dir)) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Re-apply the credit + daily-lead ceilings. The daily *search* was already
  // charged by /find, so only the lead side is metered here.
  const entitlement = await billing.getEntitlement(userId);
  const avail = entitlement.unlimited ? Infinity : (entitlement.credits || 0);
  if (!entitlement.unlimited && avail <= 0) {
    return Response.json(
      { error: "You're out of credits. Choose a plan or top up to save more leads.", code: "no_credits" },
      { status: 402 }
    );
  }
  const daily = await billing.getDailyUsage(userId);
  const dailyLeadsLeft = daily.leads.unlimited ? Infinity : daily.leads.remaining;
  if (dailyLeadsLeft <= 0) {
    return Response.json(
      {
        error: `You've reached today's ${daily.leads.limit.toLocaleString()} lead limit. It resets in ${billing.formatResetIn(daily.resetInSeconds)} (at midnight ${daily.tz}).`,
        code: "daily_lead_limit",
      },
      { status: 429 }
    );
  }

  const meta = store.readMeta(dir) || {};
  const limit = Math.min(MAX_ROWS_PER_INGEST, avail, dailyLeadsLeft, Number(meta.max) || MAX_ROWS_PER_INGEST);
  const ctx = { project: meta.name || slug, query: meta.query || "" };

  // Drop anything without a name — a row we can't identify is not a lead.
  const named = incoming.filter((r) => r && String(r.name || "").trim());

  // Then drop anything outside the search area, BEFORE the limit is applied, so
  // the user still gets up to `max` leads they actually asked for rather than a
  // page padded out with distant ones. This also runs before upsert, so nothing
  // out of area is charged for.
  const inArea = areaFilterFor(meta);
  const kept = inArea ? named.filter(inArea) : named;
  const outOfArea = named.length - kept.length;

  const rows = kept.slice(0, limit).map((r) => toLeadRow(r, ctx));

  if (!rows.length) {
    store.writeState(dir, {
      running: false, queued: false, activePid: null,
      // "Nothing found" and "found, but all of it was somewhere else" are
      // different answers, and only the second one tells the user what to
      // change.
      message: outOfArea
        ? `No leads inside your search area. ${outOfArea} ${outOfArea === 1 ? "result was" : "results were"} outside it — try a wider radius.`
        : "No leads found for this search.",
      finishedAt: new Date().toISOString(),
      stages: { scrape: { status: "done" } },
    });
    return Response.json({ ok: true, inserted: 0, updated: 0, received: incoming.length, outOfArea });
  }

  // Fill in contact details anyone has already found for these domains, BEFORE
  // the CSV is written. upsertLeads applies the shared cache to the database on
  // its own, but the CSV is what the background enrichment stage reads, so
  // without this the two disagree about what is already known.
  const fromCache = await applyEnrichmentCache(rows);

  const res = await db.upsertLeads(userId, rows);
  await billing.addDailyLeads(userId, res.inserted).catch(() => {});

  // Write the raw CSV so the workspace renders these leads like any other run.
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.csv`), buildCsv(rows), "utf8");
  } catch {
    // The DB is the source of truth; a CSV write failure must not lose leads.
  }

  store.writeState(dir, {
    running: false,
    queued: false,
    activePid: null,
    message: "Leads loaded",
    finishedAt: new Date().toISOString(),
    stages: { scrape: { status: "done" } },
    source: "extension",
    dbSync: { inserted: res.inserted, updated: res.updated, at: new Date().toISOString() },
  });

  // The leads themselves are the last word on where the search went.
  const finalMeta = reconcileMetaLocation({ dir, meta, rows });

  // Hand whatever the extension didn't finish to the server.
  //
  // The extension already tried to crawl every lead's website for emails and
  // socials (15s/site, in the user's own browser) before this request landed —
  // see runJob's enrich phase in the extension's offscreen.js. `rows` here
  // already carries email/socials for whatever it got to in time. This queues
  // the VPS pass for exactly the leftovers (no website result yet), so the
  // slow tail of a run — sites that stall or a tab that gets closed mid-crawl —
  // still finishes here rather than being lost.
  const enrich = await queueEnrichment({ userId, dir, slug, meta: finalMeta, rows });

  // Grow the public side of the product from the same scrape.
  const published = await publishToDirectory({ userId, meta: finalMeta, rows });

  return Response.json({
    ok: true,
    inserted: res.inserted,
    updated: res.updated,
    received: incoming.length,
    outOfArea,
    stored: rows.length,
    fromCache,
    enrich,
    published,
    status: store.loadStatus(finalMeta.name || slug, userId),
  });
}

// What the scraped addresses mostly say, which beats anything we predicted.
function modeOf(values) {
  const counts = new Map();
  for (const raw of values) {
    const v = String(raw || "").trim();
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = "", bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return { value: best, count: bestN };
}

// Correct the project's recorded location from the leads it actually returned.
//
// Everything upstream of this is a prediction: the dropdowns predict, the
// geocoder predicts, and when the geocoder comes back empty we have nothing.
// The addresses on the scraped rows are evidence. A project labelled Adelaide
// holding ten Islamabad addresses is a bug the user sees on the header, on every
// export, and — via publishToDirectory — on the public site.
//
// Only overwrite when the rows agree with each other (a clear majority) and
// disagree with the label. A mixed bag of cities is not a correction.
// Returns the meta to use downstream: the corrected one when it changed, the
// original otherwise, so the directory publish below never uses a label we just
// established is wrong.
function reconcileMetaLocation({ dir, meta, rows }) {
  try {
    const located = rows.map((r) => db.parseLocation(r.address || ""));
    const city = modeOf(located.map((l) => l.city));
    const country = modeOf(located.map((l) => l.country));
    // Better than half the rows have to say the same thing before it counts.
    const threshold = Math.max(2, Math.ceil(rows.length / 2));
    const patch = {};
    if (city.value && city.count >= threshold && city.value !== meta.cityName) patch.cityName = city.value;
    if (country.value && country.count >= threshold && country.value !== meta.countryName) patch.countryName = country.value;
    if (!Object.keys(patch).length) return meta;
    return store.writeMeta(dir, patch);
  } catch {
    // A wrong label is a cosmetic bug; losing the leads is not. Never throw here.
    return meta;
  }
}

// A live search covers an area the warehouse had nothing for. Those rows go
// into the shared warehouse as well as the searcher's own project, which is
// what turns "nobody has scraped Sialkot plumbers" into a directory page that
// exists from then on. The searcher keeps their private copy either way.
//
// Only aggregates reach the public record: city, service, country and a count.
// No user id and no free-typed query text, and attribution is anonymised to a
// first name and last initial inside the lib.
async function publishToDirectory({ userId, meta, rows }) {
  const cityName = String(meta.cityName || "").trim();
  const service = String(meta.service || "").trim();
  const countryCode = String(meta.countryCode || "").trim().toUpperCase();
  if (!cityName || !service || !countryCode) {
    return { published: false, reason: "not_enough_context" };
  }

  try {
    const wh = await warehousePublish.publish({
      rows,
      cityName,
      countryCode,
      countryName: meta.countryName || "",
      service,
      query: meta.query || "",
      lat: meta.areaLat || null,
      lng: meta.areaLng || null,
    });
    if (!wh.published) return wh;

    // Only list it once the warehouse actually holds the rows. Recording first
    // would publish a directory URL whose page renders from the warehouse and
    // would therefore be empty, which is exactly the thin content Google drops.
    const searcher = (await publicSearches.labelForUser(userId)) || null;
    await publicSearches.record({
      cityId: wh.cityId ?? null,
      cityName,
      countryCode,
      countryName: meta.countryName || "",
      service,
      leadCount: wh.total || rows.length,
      searcher,
    });
    return { published: true, inserted: wh.inserted, updated: wh.updated, total: wh.total };
  } catch (err) {
    console.warn("[ingest] directory publish skipped:", err?.message || err);
    return { published: false, reason: "error" };
  }
}

// Populate missing email/socials/WhatsApp status from the cross-tenant caches.
// Returns how many rows it completed — those cost no crawl at all.
async function applyEnrichmentCache(rows) {
  const before = rows.filter((r) => r.email).length;
  try {
    await db.fillLeadsFromCaches(rows);
  } catch {
    // A cache read failure is never worth failing an ingest over — the
    // background pass will find these the slow way.
    return 0;
  }
  return rows.filter((r) => r.email).length - before;
}

// Queue the background website crawl for whatever the cache couldn't answer.
// Returns { queued, pending } for the UI, or { queued: false, reason }.
async function queueEnrichment({ userId, dir, slug, meta, rows }) {
  const pending = rows.filter((r) => r.website && !r.email).length;
  if (!pending) return { queued: false, pending: 0, reason: "nothing_to_enrich" };

  // Never stack a second runner on a project that already has one: two
  // processes writing the same project's CSVs would interleave their output.
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return { queued: false, pending, reason: "already_running" };
  }

  try {
    // Carry the existing meta through — enqueue writes `query`/`max` straight
    // onto project.json, so passing blanks here would erase what /find recorded.
    await queue.enqueue(userId, {
      name: meta.name || slug,
      query: meta.query || "",
      max: meta.max || "",
      stages: ["enrich"],
      enrichEngine: "crawlee",
      enrichFast: true,
      enrichConcurrency: 30,
    });
    // enqueue leaves the project reading "waiting for a free slot", which is
    // true of the crawl but wrong about the leads — they are already saved.
    store.writeState(dir, { message: `Leads loaded, finding emails for ${pending} sites` });
    return { queued: true, pending };
  } catch (err) {
    // The leads are stored and charged for; a queue failure must not turn that
    // into an error the user sees as a lost search.
    console.warn("[ingest] background enrichment not queued:", err?.message || err);
    return { queued: false, pending, reason: "queue_failed" };
  }
}
