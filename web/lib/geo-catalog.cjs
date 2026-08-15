// World country + city catalog for LIVE (extension) searches.
//
// Deliberately separate from web/lib/warehouse.cjs. That catalog answers "where
// do we already hold leads?", which is the right question for a warehouse lookup
// and the wrong one for a live scrape - the extension can grid anywhere, so it
// gets the full world list from data/geo (see scripts/build-geo-index.cjs).
//
// Nothing here touches the warehouse tables. Mixing the two would put 153k
// lead-less cities into a table whose whole meaning is "cities with leads".
//
// Data is 153k cities across 223 files. Only the requested country is ever read,
// and a handful are kept parsed in memory, so a search costs one small file read
// at most and usually nothing.

const fs = require("fs");
const path = require("path");
const { haversineKm } = require("./geo-distance.cjs");

// Resolved from cwd, not __dirname. Next bundles server code into
// .next/server/chunks, so __dirname at runtime is the chunk's directory and
// "../../data/geo" would point inside .next. The app root is the process's cwd
// (pm2 runs `npm run start:web` from it); GMAPS_APP_ROOT overrides, matching
// web/lib/store.cjs.
const APP_ROOT = process.env.GMAPS_APP_ROOT || process.cwd();
const GEO_DIR = path.join(APP_ROOT, "data", "geo");
const CITY_DIR = path.join(GEO_DIR, "cities");

let _countries = null;
const _cityCache = new Map(); // code -> city[]   (insertion-ordered = our LRU)
const CACHE_COUNTRIES = 6;

// True when the index has been built. The app must not 500 because a deploy
// skipped the build step; callers fall back to the warehouse catalog instead.
function available() {
  try {
    return fs.existsSync(path.join(GEO_DIR, "countries.json"));
  } catch {
    return false;
  }
}

function countries() {
  if (_countries) return _countries;
  try {
    _countries = JSON.parse(fs.readFileSync(path.join(GEO_DIR, "countries.json"), "utf8"));
  } catch {
    _countries = [];
  }
  return _countries;
}

// The source data lists administrative areas alongside the settlements inside
// them, and it is ordered by population, so PK offers "Rawalpindi District"
// (3,363,911) above "Rawalpindi" (3,357,612). Two entries for one place reads as
// a bug, and picking the district centres the search on the district centroid -
// which is how a Rawalpindi search came back with Chakwal and Kalar Kahar.
//
// Nobody prospecting means the district. Where both exist in the same state,
// keep the city; where only the district exists, keep it, since dropping it
// would lose the only entry for that place.
//
// Done here, at the single point both searchCities and allCities read through,
// so neither path can miss it.
const ADMIN_SUFFIX = /\s+(district|division|tehsil|county|municipality|prefecture|province|region)$/i;

function dropAdminTwins(list) {
  if (!Array.isArray(list)) return [];
  const settlements = new Set();
  for (const c of list) {
    if (!ADMIN_SUFFIX.test(String(c.n))) settlements.add(`${String(c.n).toLowerCase()}|${c.s || ""}`);
  }
  if (!settlements.size) return list;
  return list.filter((c) => {
    const name = String(c.n);
    const bare = name.replace(ADMIN_SUFFIX, "").trim().toLowerCase();
    if (bare === name.toLowerCase()) return true; // not an administrative area
    return !settlements.has(`${bare}|${c.s || ""}`);
  });
}

function loadCities(code) {
  const key = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return []; // also stops ../ path traversal
  if (_cityCache.has(key)) {
    const hit = _cityCache.get(key); // refresh recency
    _cityCache.delete(key);
    _cityCache.set(key, hit);
    return hit;
  }
  let list = [];
  try {
    list = dropAdminTwins(JSON.parse(fs.readFileSync(path.join(CITY_DIR, `${key}.json`), "utf8")));
  } catch {
    list = [];
  }
  _cityCache.set(key, list);
  if (_cityCache.size > CACHE_COUNTRIES) {
    _cityCache.delete(_cityCache.keys().next().value); // evict least-recent
  }
  return list;
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // "Córdoba" should match a typed "cordoba"
    .trim();

/**
 * Cities in one country, optionally filtered by a typed prefix.
 * Files are pre-sorted by population, so an empty query returns the major
 * cities and matches stay in population order without re-sorting 16k rows.
 */
function searchCities(code, q = "", limit = 25) {
  const all = loadCities(code);
  const text = norm(q);
  const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
  if (!text) return all.slice(0, cap);

  // Two passes so a prefix hit always outranks a mid-word one: typing "york"
  // should offer York before New York City, and "new y" the reverse.
  const starts = [];
  const contains = [];
  for (const c of all) {
    const n = norm(c.n);
    if (n.startsWith(text)) {
      if (starts.length < cap) starts.push(c);
    } else if (starts.length + contains.length < cap * 2 && n.includes(text)) {
      contains.push(c);
    }
    if (starts.length >= cap) break;
  }
  return starts.concat(contains).slice(0, cap);
}

// Every city in one country, in population order. The client fetches this once
// when a country is picked and filters in memory from then on, so typing costs
// nothing - see LiveAreaPicker. Worst case (US, 16,731) is ~285KB gzipped.
function allCities(code) {
  return loadCities(code);
}

// The city a coordinate falls in, or nearest to it. Used to turn the latitude
// and longitude Cloudflare derives from the visitor's IP into a city we can
// actually preselect. `maxKm` keeps a wildly-off fix from silently selecting a
// city hundreds of km away - better to preselect nothing than the wrong place.
function nearestCity(code, lat, lng, maxKm = 120) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let best = null;
  let bestKm = Infinity;
  for (const c of loadCities(code)) {
    if (!Number.isFinite(c.la) || !Number.isFinite(c.ln)) continue;
    const km = haversineKm(a, b, c.la, c.ln);
    if (km < bestKm) { bestKm = km; best = c; }
  }
  return best && bestKm <= maxKm ? { ...best, distanceKm: Math.round(bestKm) } : null;
}

// A city by name within one country, for the case where we are given a name
// rather than a coordinate.
function cityByName(code, name) {
  const wanted = norm(name);
  if (!wanted) return null;
  return loadCities(code).find((c) => norm(c.n) === wanted) || null;
}

module.exports = { available, countries, searchCities, allCities, nearestCity, cityByName };
