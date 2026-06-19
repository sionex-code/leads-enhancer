// warehouse.cjs — thin HTTP client for the gmaps-scraper-standalone warehouse server.
//
// This is the READ side of the warehouse. The write side (scraping, storing leads)
// lives in the standalone repo (gmaps-scraper-standalone) under warehouse-server.cjs.
//
// Required env:
//   WAREHOUSE_URL   — base URL of the warehouse HTTP server (default: http://127.0.0.1:3200)
//   WAREHOUSE_TOKEN — Bearer token for all requests; find it in
//                     gmaps-scraper-standalone/.warehouse-token.txt on the worker VPS.
//                     Must be set before calling any exported function.
//
// Exports:
//   catalog()       — GET /catalog; returns { countries, services }. Cached 5 min in-module.
//   queryLeads(f)   — POST /query-leads with filter body; returns { total, rows }.
//   toLeadRow(wh)   — maps a warehouse lead object to the shape expected by db.upsertLeads.

"use strict";

const WAREHOUSE_URL = () => (process.env.WAREHOUSE_URL || "http://127.0.0.1:3200").replace(/\/+$/, "");
const WAREHOUSE_TOKEN = () => {
  const t = process.env.WAREHOUSE_TOKEN;
  if (!t) throw new Error("[warehouse] WAREHOUSE_TOKEN env var is not set — set it to the token from gmaps-scraper-standalone/.warehouse-token.txt");
  return t;
};

function authHeader() {
  return { Authorization: `Bearer ${WAREHOUSE_TOKEN()}` };
}

// ---- catalog (cached 5 minutes) ---------------------------------------------
let _catalogCache = null;
let _catalogAt = 0;
const CATALOG_TTL_MS = 5 * 60 * 1000;

async function catalog() {
  const now = Date.now();
  if (_catalogCache && now - _catalogAt < CATALOG_TTL_MS) return _catalogCache;

  const res = await fetch(`${WAREHOUSE_URL()}/catalog`, {
    headers: { ...authHeader() },
  });
  if (!res.ok) throw new Error(`[warehouse] GET /catalog failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  _catalogCache = data;
  _catalogAt = now;
  return data; // { countries, services }
}

// ---- queryLeads -------------------------------------------------------------
/**
 * Query warehouse leads with optional filters.
 * @param {object} filters
 * @param {string} [filters.countryCode]
 * @param {string|number} [filters.cityId]
 * @param {string} [filters.service]
 * @param {number} [filters.minRating]
 * @param {number} [filters.centerLat]
 * @param {number} [filters.centerLng]
 * @param {number} [filters.radiusKm]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Promise<{ total: number, rows: object[] }>}
 */
async function queryLeads(filters = {}) {
  const res = await fetch(`${WAREHOUSE_URL()}/query-leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(filters),
  });
  if (!res.ok) throw new Error(`[warehouse] POST /query-leads failed: ${res.status} ${res.statusText}`);
  return res.json(); // { total, rows }
}

// ---- toLeadRow --------------------------------------------------------------
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
