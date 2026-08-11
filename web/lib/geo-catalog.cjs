// World country + city catalog for LIVE (extension) searches.
//
// Deliberately separate from web/lib/warehouse.cjs. That catalog answers "where
// do we already hold leads?", which is the right question for a warehouse lookup
// and the wrong one for a live scrape — the extension can grid anywhere, so it
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
    list = JSON.parse(fs.readFileSync(path.join(CITY_DIR, `${key}.json`), "utf8"));
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
// nothing — see LiveAreaPicker. Worst case (US, 16,731) is ~285KB gzipped.
function allCities(code) {
  return loadCities(code);
}

module.exports = { available, countries, searchCities, allCities };
