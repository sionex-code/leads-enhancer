// warehouse.cjs — direct Postgres client for the gmaps-scraper-standalone warehouse DB.
//
// Replaces the previous HTTP-based client (WAREHOUSE_URL / WAREHOUSE_TOKEN) with a
// dedicated pg.Pool so Find-leads queries bypass the single-threaded warehouse HTTP
// server entirely.
//
// Required env:
//   WAREHOUSE_DATABASE_URL — connection string for the standalone warehouse Postgres.
//                            Example: postgresql://warehouse:PASSWORD@127.0.0.1:5433/warehouse
//                            In local dev you need an SSH tunnel to the VPS Postgres.
//
// Exports:
//   catalog()         — returns { countries, services }. Cached 5 min in-module.
//   queryLeads(f)     — returns { total, rows } using filters.
//   toLeadRow(wh)     — maps a warehouse lead row to the shape expected by db.upsertLeads.

"use strict";

const { Pool } = require("pg");

// ---- lazy singleton pool -------------------------------------------------------

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  const url = process.env.WAREHOUSE_DATABASE_URL;
  if (!url) {
    throw new Error(
      "[warehouse] WAREHOUSE_DATABASE_URL env var is not set — set it to the warehouse Postgres connection string. " +
      "Example: postgresql://warehouse:PASSWORD@127.0.0.1:5433/warehouse"
    );
  }
  _pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  _pool.on("error", (err) => {
    console.error("[warehouse-pg] idle client error:", err.message);
  });
  return _pool;
}

// ---- haversine helper ----------------------------------------------------------

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- catalog (stale-while-revalidate) ------------------------------------------
//
// The per-city / per-service counts require a full sequential scan of the ~2.5M-row
// leads table (≈9s). To keep that off the request path we serve a cached snapshot
// and refresh it in the BACKGROUND when stale, persist it to disk so restarts are
// instant, and warm it on boot. A user therefore never waits on the heavy query
// (only the very first cold boot with no disk cache does, in the background).

const fs = require("fs");
const os = require("os");
const path = require("path");

let _catalogCache = null;
let _catalogAt = 0;
let _catalogInflight = null;
const CATALOG_TTL_MS = 30 * 60 * 1000; // serve a cached snapshot up to 30 min old
const CATALOG_DISK = path.join(os.tmpdir(), "leadsfunda-catalog-cache.json");

function _loadDiskCache() {
  if (_catalogCache) return;
  try {
    const obj = JSON.parse(fs.readFileSync(CATALOG_DISK, "utf8"));
    if (obj && obj.data && obj.at) { _catalogCache = obj.data; _catalogAt = obj.at; }
  } catch { /* no disk cache yet — fine */ }
}

function _saveDiskCache() {
  try {
    fs.writeFileSync(CATALOG_DISK, JSON.stringify({ at: _catalogAt, data: _catalogCache }));
  } catch { /* best effort */ }
}

// Kick a background refresh; concurrent callers share one in-flight compute.
function refreshCatalog() {
  if (_catalogInflight) return _catalogInflight;
  _catalogInflight = computeCatalog()
    .then((data) => {
      _catalogCache = data;
      _catalogAt = Date.now();
      _saveDiskCache();
      return data;
    })
    .catch((err) => {
      console.error("[warehouse] catalog refresh failed:", err.message);
      throw err;
    })
    .finally(() => { _catalogInflight = null; });
  return _catalogInflight;
}

async function catalog() {
  _loadDiskCache();
  const age = Date.now() - _catalogAt;
  if (_catalogCache && age < CATALOG_TTL_MS) return _catalogCache; // fresh
  if (_catalogCache) {
    refreshCatalog().catch(() => {}); // stale: refresh in background, keep serving stale
    return _catalogCache;
  }
  return refreshCatalog(); // cold (no cache anywhere): must wait this once
}

async function computeCatalog() {
  const pool = getPool();

  // Per-city lead counts
  const citySql = `
    SELECT
      ci.id,
      ci.name,
      ci.admin,
      ci.lat,
      ci.lng,
      co.code   AS country_code,
      co.name   AS country_name,
      COUNT(l.id) AS lead_count
    FROM cities ci
    JOIN countries co ON co.id = ci.country_id
    LEFT JOIN leads l ON l.city_id = ci.id
    GROUP BY ci.id, ci.name, ci.admin, ci.lat, ci.lng, co.code, co.name
    HAVING COUNT(l.id) > 0
    ORDER BY co.name, ci.name
  `;

  // Per-service lead counts
  const serviceSql = `
    SELECT
      s.name,
      s.category,
      COUNT(l.id) AS lead_count
    FROM services s
    LEFT JOIN leads l ON l.service_id = s.id
    GROUP BY s.id, s.name, s.category
    HAVING COUNT(l.id) > 0
    ORDER BY COUNT(l.id) DESC, s.name
  `;

  const [cityRes, serviceRes] = await Promise.all([
    pool.query(citySql),
    pool.query(serviceSql),
  ]);

  // Assemble countries -> cities tree
  const countryMap = new Map(); // code -> { code, name, leadCount, cities[] }
  for (const row of cityRes.rows) {
    const code = row.country_code;
    if (!countryMap.has(code)) {
      countryMap.set(code, { code, name: row.country_name, leadCount: 0, cities: [] });
    }
    const country = countryMap.get(code);
    const lc = Number(row.lead_count);
    country.leadCount += lc;
    country.cities.push({
      id: row.id,
      name: row.name,
      admin: row.admin,
      lat: row.lat,
      lng: row.lng,
      leadCount: lc,
    });
  }

  const countries = Array.from(countryMap.values());
  const services = serviceRes.rows.map((r) => ({
    name: r.name,
    category: r.category,
    leadCount: Number(r.lead_count),
  }));

  return { countries, services };
}

// Warm the cache on boot (from disk if present, else compute once in the
// background) so the first real request is served instantly.
_loadDiskCache();
if (!_catalogCache || Date.now() - _catalogAt >= CATALOG_TTL_MS) {
  refreshCatalog().catch(() => {});
}

// ---- queryLeads ----------------------------------------------------------------

// Qualify every column with `leads.` — when a service/country filter adds a JOIN
// (services/cities/countries all have id, name, category, lat, lng), bare column
// names like `id` would be ambiguous (Postgres error 42702). The result column
// names are unchanged (Postgres drops the table qualifier), so toLeadRow/buildCsv
// keep working.
const LEAD_COL_NAMES = [
  "id", "name", "category", "rating", "reviews", "website", "phone", "address",
  "plus_code", "hours", "image_urls", "maps_url", "place_id", "lat", "lng",
  "email", "socials", "owner_replied", "owner_reply_count", "city_id", "service_id",
];
const LEAD_COLUMNS = LEAD_COL_NAMES.map((c) => `leads.${c}`).join(", ");

/**
 * Query warehouse leads with optional filters.
 * @param {object} filters
 * @param {string}        [filters.countryCode]
 * @param {string|number} [filters.cityId]
 * @param {string}        [filters.service]
 * @param {number}        [filters.minRating]
 * @param {number}        [filters.centerLat]
 * @param {number}        [filters.centerLng]
 * @param {number}        [filters.radiusKm]
 * @param {number}        [filters.limit]
 * @param {number}        [filters.offset]
 * @returns {Promise<{ total: number, rows: object[] }>}
 */
async function queryLeads(filters = {}) {
  const {
    countryCode,
    cityId,
    service,
    minRating,
    maxRating,
    centerLat,
    centerLng,
    radiusKm,
    limit: rawLimit,
    offset: rawOffset,
  } = filters;

  const limit = Math.min(Number(rawLimit) || 50, 10000);
  const offset = Number(rawOffset) || 0;

  const pool = getPool();

  // Determine if we need a radius query
  const useRadius =
    centerLat != null && centerLng != null && radiusKm != null;

  // Build JOIN clauses and WHERE conditions
  const joins = [];
  const where = [];
  const params = [];

  function addParam(val) {
    params.push(val);
    return `$${params.length}`;
  }

  // Country filter: join cities + countries
  if (countryCode) {
    joins.push("JOIN cities _ci ON _ci.id = leads.city_id");
    joins.push("JOIN countries _co ON _co.id = _ci.country_id");
    where.push(`_co.code = ${addParam(String(countryCode).toUpperCase())}`);
  }

  // City filter (direct)
  if (cityId != null) {
    where.push(`leads.city_id = ${addParam(Number(cityId))}`);
  }

  // Service filter
  if (service) {
    joins.push("JOIN services _sv ON _sv.id = leads.service_id");
    where.push(`_sv.name = ${addParam(service)}`);
  }

  // Min rating filter
  if (minRating != null) {
    where.push(`NULLIF(leads.rating, '')::real >= ${addParam(Number(minRating))}`);
  }

  // Max rating filter ("rating less than")
  if (maxRating != null) {
    where.push(`NULLIF(leads.rating, '')::real < ${addParam(Number(maxRating))}`);
  }

  // Radius: bounding box in SQL, haversine refinement in JS
  if (useRadius) {
    const d = Number(radiusKm) / 111;
    const latRad = (Number(centerLat) * Math.PI) / 180;
    const dLng = d / Math.cos(latRad);
    const minLat = Number(centerLat) - d;
    const maxLat = Number(centerLat) + d;
    const minLng = Number(centerLng) - dLng;
    const maxLng = Number(centerLng) + dLng;
    where.push(`leads.lat IS NOT NULL AND leads.lng IS NOT NULL`);
    where.push(`leads.lat BETWEEN ${addParam(minLat)} AND ${addParam(maxLat)}`);
    where.push(`leads.lng BETWEEN ${addParam(minLng)} AND ${addParam(maxLng)}`);
  }

  const joinClause = joins.length ? joins.join("\n    ") : "";
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  if (useRadius) {
    // Fetch all bounding-box rows, refine with haversine in JS
    const sql = `
      SELECT ${LEAD_COLUMNS}
      FROM leads
      ${joinClause}
      ${whereClause}
    `;
    const res = await pool.query(sql, params);
    const refined = res.rows.filter(
      (r) =>
        haversineKm(
          Number(centerLat),
          Number(centerLng),
          Number(r.lat),
          Number(r.lng)
        ) <= Number(radiusKm)
    );
    const total = refined.length;
    const rows = refined.slice(offset, offset + limit);
    return { total, rows };
  }

  // Non-radius: COUNT + paginated SELECT
  const countSql = `
    SELECT COUNT(*) AS total
    FROM leads
    ${joinClause}
    ${whereClause}
  `;
  const countRes = await pool.query(countSql, params);
  const total = Number(countRes.rows[0].total);

  // Paginated query — add LIMIT and OFFSET as extra params
  const limitParam = addParam(limit);
  const offsetParam = addParam(offset);
  const rowsSql = `
    SELECT ${LEAD_COLUMNS}
    FROM leads
    ${joinClause}
    ${whereClause}
    ORDER BY NULLIF(leads.reviews, '')::int DESC NULLS LAST
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;
  const rowsRes = await pool.query(rowsSql, params);
  return { total, rows: rowsRes.rows };
}

// ---- toLeadRow (UNCHANGED) -----------------------------------------------------
/**
 * Map a raw warehouse lead row to the snake_case shape consumed by db.upsertLeads /
 * normalizeLead. Keys here must match what normalizeLead's `g()` helper looks up
 * (it accepts both snake_case and the camelCase alias listed in each call).
 *
 * Warehouse socials field is either a JSON string or an object like
 * { facebook, instagram, linkedin, twitter } — we expand it to flat keys.
 *
 * @param {object} wh - a warehouse lead row
 * @returns {object} - row suitable for db.upsertLeads
 */
function toLeadRow(wh) {
  // Parse socials: warehouse may store it as a JSON string or already as an object.
  let socials = {};
  if (wh.socials) {
    if (typeof wh.socials === "string") {
      try { socials = JSON.parse(wh.socials); } catch { socials = {}; }
    } else if (typeof wh.socials === "object") {
      socials = wh.socials;
    }
  }

  return {
    // Core business fields
    name: wh.name || "",
    category: wh.category || "",
    rating: wh.rating != null ? String(wh.rating) : "",
    reviews: wh.reviews != null ? String(wh.reviews) : "",
    website: wh.website || "",
    phone: wh.phone || "",
    address: wh.address || "",
    // plus_code: normalizeLead accepts "plusCode" or "plus_code"
    plus_code: wh.plus_code || wh.plusCode || "",
    hours: wh.hours || "",
    // maps_url: normalizeLead accepts "mapsUrl" or "maps_url"
    maps_url: wh.maps_url || wh.mapsUrl || "",
    // image_urls: normalizeLead accepts "imageUrls" or "image_urls"
    image_urls: wh.image_urls || wh.imageUrls || "",
    // Coordinates (warehouse-only; written directly, bypassing normalizeLead's g())
    lat: wh.lat != null ? Number(wh.lat) : null,
    lng: wh.lng != null ? Number(wh.lng) : null,
    // Owner-reply counters
    owner_replied: wh.owner_replied != null ? Number(wh.owner_replied) : null,
    owner_reply_count: wh.owner_reply_count != null ? Number(wh.owner_reply_count) : null,
    // Contact / enrichment
    email: wh.email || "",
    // all_emails: normalizeLead accepts "allEmails" or "all_emails"
    all_emails: wh.all_emails || wh.allEmails || "",
    // Socials expanded from the warehouse socials object
    facebook: socials.facebook || wh.facebook || "",
    instagram: socials.instagram || wh.instagram || "",
    linkedin: socials.linkedin || wh.linkedin || "",
    twitter: socials.twitter || wh.twitter || "",
  };
}

module.exports = { catalog, queryLeads, toLeadRow };
