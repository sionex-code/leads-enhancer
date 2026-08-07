// Publishes leads scraped live in a user's browser into the shared warehouse,
// so a search for an area nobody has covered yet turns into a public directory
// page instead of dying inside one tenant's project.
//
// Why this file exists rather than a call into `wh-db.cjs`: that module drives
// the wh-ie-* crawl workers and lives only on the server, outside this repo.
// Requiring it here would break every local build and couple the web app to an
// untracked file. The SQL below therefore talks to the same tables directly,
// through the pool `warehouse.cjs` already owns.
//
// Three rules this code will not break:
//
//   1. It never enqueues crawl work. New keyword rows are written with
//      status 'done', and `claimKeyword` only ever claims 'pending'. A user
//      typing a city name must not be able to put the 8 background workers to
//      work on it.
//   2. It only accepts a country the geocoder verified. The warehouse ships
//      with 20 curated crawl targets and Pakistan is not among them, so
//      refusing anything off that list would mean a Lahore search could never
//      become a public page. New countries are therefore created, but only
//      from Nominatim's ISO `address.country_code`, never from typed text, and
//      always behind the curated ones in crawl priority.
//   3. It never fails the caller. Publishing is a side benefit of a search the
//      user already paid for, so every error is swallowed and reported.
"use strict";

const warehouse = require("./warehouse.cjs");

const q = (text, params = []) => warehouse.getPool().query(text, params);

// Below this a live search is a fluke or a typo rather than coverage worth
// publishing, and writing it would fill the catalog with one-row cities.
const MIN_PUBLISH_ROWS = 10;

// Same shape `wh-db.cjs#leadKey` produces. It MUST stay identical: the
// warehouse dedups on this single unique column, so a different scheme here
// would insert duplicates of businesses the crawlers already hold.
function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : "http://" + url).hostname
      .replace(/^www\./, "")
      .toLowerCase();
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

const clean = (s) => String(s == null ? "" : s).trim();
const nowIso = () => new Date().toISOString();

// Cities and services are matched case-insensitively on their names, because
// the same place arrives as "lahore" from a typed query and "Lahore" from the
// dropdown, and two rows for one city would split its directory page in half.
async function findOrCreateCountry(code, name) {
  const c = clean(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const found = await q(`SELECT id FROM countries WHERE upper(code) = $1 LIMIT 1`, [c]);
  if (found.rows[0]) return found.rows[0].id;

  // A country the crawl catalog has never targeted. It needs a name we can
  // trust, so an ISO code with no accompanying country name is refused rather
  // than stored as a two-letter placeholder on a public page.
  const nm = clean(name);
  if (!nm) return null;

  // priority 999 keeps every hand-curated country ahead of it wherever the
  // crawl workers order their targets.
  const ins = await q(
    `INSERT INTO countries (code, name, region, language, priority, created_at, updated_at)
     VALUES ($1, $2, '', '', 999, now(), now())
     ON CONFLICT (code) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [c, nm]
  );
  return ins.rows[0]?.id ?? null;
}

async function findOrCreateCity({ countryId, name, lat, lng }) {
  const nm = clean(name);
  if (!countryId || !nm) return null;
  const found = await q(
    `SELECT id FROM cities WHERE country_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [countryId, nm]
  );
  if (found.rows[0]) return found.rows[0].id;

  // The unique key is (country_id, name, admin), so admin has to be a concrete
  // value rather than NULL or two inserts of the same city both succeed.
  const ins = await q(
    `INSERT INTO cities (country_id, name, admin, lat, lng, created_at, updated_at)
     VALUES ($1, $2, '', $3, $4, now(), now())
     ON CONFLICT (country_id, name, admin) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [countryId, nm, Number.isFinite(Number(lat)) ? Number(lat) : null,
     Number.isFinite(Number(lng)) ? Number(lng) : null]
  );
  return ins.rows[0]?.id ?? null;
}

async function findOrCreateService(name) {
  const nm = clean(name).toLowerCase();
  if (!nm) return null;
  const found = await q(`SELECT id FROM services WHERE lower(name) = $1 LIMIT 1`, [nm]);
  if (found.rows[0]) return found.rows[0].id;
  const ins = await q(
    `INSERT INTO services (name, category, created_at) VALUES ($1, '', now())
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [nm]
  );
  return ins.rows[0]?.id ?? null;
}

// status 'done' on purpose: see rule 1 at the top of this file.
async function findOrCreateKeyword({ cityId, serviceId, query, leadCount }) {
  if (!cityId || !serviceId) return null;
  const ins = await q(
    `INSERT INTO keywords (city_id, service_id, query, status, target, lead_count, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, 'done', 0, $4, 1, now(), now())
     ON CONFLICT (city_id, service_id) DO UPDATE SET
       lead_count = GREATEST(keywords.lead_count, EXCLUDED.lead_count),
       updated_at = now()
     RETURNING id`,
    [cityId, serviceId, clean(query).slice(0, 200), Math.max(0, Number(leadCount) || 0)]
  );
  return ins.rows[0]?.id ?? null;
}

const LEAD_COLS = [
  "keyword_id", "city_id", "service_id", "dedup_key", "name", "category",
  "rating", "reviews", "website", "website_text", "phone", "address",
  "plus_code", "hours", "image_urls", "maps_url", "place_id", "lat", "lng",
  "created_at", "updated_at",
];

// Accepts the CSV-shaped rows /ingest already built, so the caller does not
// need a second mapping pass.
function toWarehouseRow(r, { keywordId, cityId, serviceId }) {
  const ts = nowIso();
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return [
    keywordId, cityId, serviceId,
    leadKey(r) || null, // NULL, never '', so the partial unique index skips it
    clean(r.name), clean(r.category), clean(r.rating), clean(r.reviews),
    clean(r.website), "", clean(r.phone), clean(r.address),
    clean(r.plus_code), clean(r.hours), "", clean(r.maps_url), clean(r.place_id),
    num(r.lat), num(r.lng), ts, ts,
  ];
}

// Merge rule mirrors the crawlers': a new non-empty value fills or replaces, an
// empty one never wipes what is already there. A live scrape is usually thinner
// than a full crawl, so it must not be able to blank out fields.
const SET_CLAUSE = LEAD_COLS
  .filter((c) => !["dedup_key", "created_at"].includes(c))
  .map((c) =>
    ["lat", "lng", "keyword_id", "city_id", "service_id"].includes(c)
      ? `${c} = COALESCE(EXCLUDED.${c}, leads.${c})`
      : `${c} = COALESCE(NULLIF(EXCLUDED.${c}, ''), leads.${c})`
  )
  .join(", ");

/**
 * Publish one live search's rows.
 * @returns {Promise<{published:boolean, inserted?:number, updated?:number, reason?:string}>}
 */
async function publish({ rows, cityName, countryCode, countryName, service, query, lat, lng }) {
  try {
    const usable = (rows || []).filter((r) => clean(r.name));
    if (usable.length < MIN_PUBLISH_ROWS) {
      return { published: false, reason: "too_few_rows" };
    }
    if (!clean(cityName) || !clean(service)) {
      return { published: false, reason: "no_city_or_service" };
    }

    const countryId = await findOrCreateCountry(countryCode, countryName);
    if (!countryId) return { published: false, reason: "unknown_country" };

    const cityId = await findOrCreateCity({ countryId, name: cityName, lat, lng });
    const serviceId = await findOrCreateService(service);
    if (!cityId || !serviceId) return { published: false, reason: "catalog_write_failed" };

    const keywordId = await findOrCreateKeyword({
      cityId, serviceId, query: query || `${service} in ${cityName}`, leadCount: usable.length,
    });
    if (!keywordId) return { published: false, reason: "keyword_write_failed" };

    // Dedupe within the batch first: a multi-row ON CONFLICT cannot touch the
    // same dedup_key twice in one statement.
    const seen = new Set();
    const values = [];
    for (const r of usable) {
      const key = leadKey(r);
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      values.push(toWarehouseRow(r, { keywordId, cityId, serviceId }));
    }

    let inserted = 0;
    let returned = 0;
    const CHUNK = 300;
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
      const n = LEAD_COLS.length;
      const tuples = slice
        .map((_, r) => "(" + LEAD_COLS.map((__, c) => `$${r * n + c + 1}`).join(", ") + ")")
        .join(", ");
      const res = await q(
        `INSERT INTO leads (${LEAD_COLS.join(", ")}) VALUES ${tuples}
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL AND dedup_key <> ''
         DO UPDATE SET ${SET_CLAUSE}
         RETURNING (xmax = 0) AS inserted`,
        slice.flat()
      );
      for (const row of res.rows) {
        returned++;
        if (row.inserted) inserted++;
      }
    }

    // The catalog is cached in-process and on disk; a brand new city would stay
    // invisible to the dropdowns until the next restart without this.
    try { warehouse.refreshCatalog(); } catch {}

    // What the warehouse now holds for this city and service, not just what
    // this batch added. That total is the number the directory page publishes
    // and the number its publish threshold is measured against, so a repeat
    // search of an area must not reset it to the size of one scrape.
    let total = values.length;
    try {
      const c = await q(
        `SELECT count(*)::int AS c FROM leads WHERE city_id = $1 AND service_id = $2`,
        [cityId, serviceId]
      );
      total = c.rows[0]?.c ?? total;
    } catch {
      // fall back to the batch size rather than losing the publish
    }

    return { published: true, cityId, serviceId, inserted, updated: returned - inserted, total };
  } catch (err) {
    console.warn("[warehouse-publish] skipped:", err.message);
    return { published: false, reason: "error" };
  }
}

module.exports = { publish, leadKey, hostOf, MIN_PUBLISH_ROWS };
