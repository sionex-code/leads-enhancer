// Turn a free-text search ("Gujrat Plumber", "dentists in Lahore") into a
// keyword plus a real geographic bounding box.
//
// Why this exists: a live search sends the typed text to Google Maps, but the
// extension's grid engine geofences the results to the area it was given. When
// that area came from the city dropdown, every result Google returned for the
// typed location fell outside it and was silently discarded - a search for
// "Gujrat Plumber" with the dropdown on Uppsala returned 20 Pakistani/Indian
// plumbers and kept zero of them. The area has to come from the same text the
// keyword does.
//
// The logic mirrors gridscrape.cjs (resolveQuery + planGrid). That file is a
// CLI: it reads process.argv and a template file at import time, so it can't be
// required from a route. Keep the two in sync if either changes.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // lowercased query -> { at, value }

// Nominatim asks for max 1 request/second. Each extra candidate therefore costs
// a real second of user-visible latency in /find, so only try the three most
// likely splits rather than every suffix length.
const MAX_CANDIDATES = 3;
const NOMINATIM_GAP_MS = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(location, { strict = false, timeoutMs = 6000 } = {}) {
  const url =
    // addressdetails=1 is what carries `address.country_code`. Without it the
    // country can only be guessed from the tail of the display string, which is
    // a localised name and not something the warehouse can key on.
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&accept-language=en&q=" +
    encodeURIComponent(location);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "leadsfunda/1.0 (lead research tool)" },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    // strict = the location is a guess taken from the tail of the query, so
    // only accept an actual place/area - never a business or street that
    // happens to share the name.
    const usable = arr.filter(
      (r) => r.boundingbox && (!strict || r.category === "boundary" || r.category === "place")
    );
    if (!usable.length) return null;
    // Nominatim sorts by relevance to the string, not by how prominent the place
    // is, so take the most important match rather than the first - but a
    // settlement beats an administrative boundary before importance is even
    // considered. Searching "Bhalwal" returns the boundary "Bhalwal Tehsil"
    // (importance 0.395) above the town "Bhalwal" (0.336), and picking on
    // importance alone is how projects ended up labelled "Bhalwal Tehsil" and
    // "Zone IV" - administrative units nobody prospects by.
    const mostImportant = (list) =>
      list.reduce((a, b) => ((Number(b.importance) || 0) > (Number(a.importance) || 0) ? b : a));
    const places = usable.filter((r) => r.category === "place");
    const hit = mostImportant(places.length ? places : usable);
    const [latMin, latMax, lngMin, lngMax] = hit.boundingbox.map(Number);
    if (![latMin, latMax, lngMin, lngMax].every(Number.isFinite)) return null;
    const display = hit.display_name || location;
    return {
      latMin, latMax, lngMin, lngMax,
      display,
      // Just the place, for labels: "Islamabad" rather than the full
      // "Islamabad, Zone 1, Islamabad Capital Territory, 44000, Pakistan".
      shortName: placeLabel(hit, display, location),
      // ISO-3166 alpha-2, so a resolved area can be matched against the
      // warehouse's country list. Nominatim reports it lower case.
      countryCode: String(hit.address?.country_code || "").toUpperCase(),
      countryName: String(hit.address?.country || "").trim(),
      lat: Number(hit.lat), lng: Number(hit.lon),
      importance: Number(hit.importance) || 0,
    };
  } catch {
    return null; // network/timeout: caller falls back to the dropdown area
  } finally {
    clearTimeout(timer);
  }
}

// Administrative units that carry a settlement's name without being one. A
// project called "Bhalwal Tehsil" or "Zone IV" reads as a bug, and those names
// reach the project header, the export and the public directory.
const ADMIN_UNIT =
  /^(zone\s+[ivxlc\d]+|.*\s(tehsil|district|division|subdivision|county|prefecture|municipality|union council))$/i;

// The place to put on a label. Nominatim's own `name` is whatever the matched
// object is called, so a boundary hit is named after the boundary; the address
// block carries the settlement it sits in, which is what a person means.
function placeLabel(hit, display, fallback) {
  const a = hit.address || {};
  const raw = String(hit.name || display.split(",")[0] || fallback || "").trim();
  if (!ADMIN_UNIT.test(raw)) return raw;
  const better = [a.city, a.town, a.village, a.municipality, a.suburb]
    .map((v) => String(v || "").trim())
    .find((v) => v && !ADMIN_UNIT.test(v));
  if (better) return better;
  // Nothing better on offer: at least drop the unit word, so "Bhalwal Tehsil"
  // becomes "Bhalwal". A bare "Zone IV" has no settlement in it and is left
  // alone rather than mangled.
  const stripped = raw.replace(/\s+(tehsil|district|division|subdivision|county|prefecture|municipality|union council)$/i, "").trim();
  return stripped || raw;
}

// Pad a near-point box up to a usable area and pick grid steps that keep the
// tile count sane. Same constants as gridscrape.cjs#planGrid.
function planGrid(bbox) {
  let { latMin, latMax, lngMin, lngMax } = bbox;
  const MIN_LAT_SPAN = 0.12, MIN_LNG_SPAN = 0.16; // ~13x15 km floor
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
  const tilesOf = () =>
    Math.ceil((latMax - latMin) / latStep) * Math.ceil((lngMax - lngMin) / lngStep);
  const MAX_TILES = 400;
  if (tilesOf() > MAX_TILES) {
    const k = Math.sqrt(tilesOf() / MAX_TILES);
    latStep *= k; lngStep *= k;
  }
  return { bbox: { latMin, latMax, lngMin, lngMax }, latStep, lngStep };
}

// Candidate keyword/location splits.
// `explicit` splits state the location outright ("plumbers in Lahore"); `guess`
// splits are inferred from word order and have to compete on merit.
function splitCandidates(q) {
  const explicit = [];
  const guess = [];
  const m = /^(.*\S)\s+(?:in|near)\s+(\S.*)$/i.exec(q);
  if (m) explicit.push({ keyword: m[1].trim(), location: m[2].trim(), strict: false });
  const comma = q.indexOf(",");
  if (comma > 0) {
    explicit.push({ keyword: q.slice(0, comma).trim(), location: q.slice(comma + 1).trim(), strict: false });
  }
  const words = q.trim().split(/\s+/);
  // Trailing words as the location ("plumbers Lahore"), longest suffix first.
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) {
    guess.push({ keyword: words.slice(0, -k).join(" "), location: words.slice(-k).join(" "), strict: true });
  }
  // Leading words as the location ("Gujrat Plumber") - reverse word order is
  // normal in South Asian and many non-English queries, and a suffix-only scan
  // never resolves it.
  for (let k = 1; k <= Math.min(3, words.length - 1); k++) {
    guess.push({ keyword: words.slice(k).join(" "), location: words.slice(0, k).join(" "), strict: true });
  }
  const ok = (c) => c.keyword && c.location;
  return { explicit: explicit.filter(ok), guess: guess.filter(ok) };
}

// Below this, a "place" match is too obscure to be what the user meant. A
// village in Nigeria called Pizza scores 0.15; Gujrat scores 0.46, Uppsala
// 0.67. Only decisive when a single guess resolves - otherwise the guesses are
// ranked against each other.
const MIN_GUESS_IMPORTANCE = 0.25;

/**
 * Resolve free text to { keyword, location, display, bbox, latStep, lngStep }.
 * Returns null when nothing in the text names a place we can locate - the
 * caller should then fall back to the user's selected city.
 */
async function resolveArea(query, { allowWholeQueryFallback = true } = {}) {
  const q = String(query || "").trim();
  if (!q) return null;

  // The fallback flag changes what this function is willing to return for the
  // exact same string, so it has to be part of the cache key - otherwise an
  // earlier unguarded call (or vice versa) serves its answer to a later call
  // that asked for the opposite, for as long as the entry lives.
  const key = `${allowWholeQueryFallback ? 1 : 0}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const pack = (c, geo) => {
    const { bbox, latStep, lngStep } = planGrid(geo);
    return {
      keyword: c.keyword, location: c.location,
      display: geo.display, shortName: geo.shortName,
      // Carried through so a resolved area can be published to the warehouse
      // and named on the public directory without a second geocode.
      countryCode: geo.countryCode || "", countryName: geo.countryName || "",
      lat: geo.lat, lng: geo.lng,
      bbox, latStep, lngStep,
    };
  };

  let value = null;
  const { explicit, guess } = splitCandidates(q);
  let calls = 0;

  // An explicit "in <place>" or "<thing>, <place>" says outright which half is
  // the location, so the first one that resolves wins - nothing to weigh up.
  for (const c of explicit) {
    if (calls++) await sleep(NOMINATIM_GAP_MS);
    const geo = await geocode(c.location, { strict: c.strict });
    if (geo) { value = pack(c, geo); break; }
  }

  // Guesses are a different problem: for "gujrat pizza" both halves resolve to
  // *something* - the city of Gujrat and a village named Pizza. Taking the
  // first hit picked the village and searched Nigeria. Score them all and keep
  // the most prominent place instead.
  if (!value) {
    const hits = [];
    for (const c of guess.slice(0, MAX_CANDIDATES)) {
      if (calls++) await sleep(NOMINATIM_GAP_MS);
      const geo = await geocode(c.location, { strict: c.strict });
      // Drop the obscure matches first, so ranking only ever sees real places.
      if (geo && geo.importance >= MIN_GUESS_IMPORTANCE) hits.push({ c, geo });
    }
    // Then prefer the most *specific* location, not the most famous one.
    // "restaurant Uppsala Sweden" resolves both "Uppsala Sweden" and "Sweden";
    // importance alone picks the whole country and scrapes a nation for one
    // city's restaurants. Whichever reading consumes more of the text as the
    // location is the narrower search, so it wins; importance breaks ties.
    const words = (s) => s.trim().split(/\s+/).length;
    hits.sort((a, b) =>
      words(b.c.location) - words(a.c.location) || b.geo.importance - a.geo.importance
    );
    if (hits.length) value = pack(hits[0].c, hits[0].geo);
  }

  // Nothing split cleanly. The whole query may just be a place - typing
  // "islamabad" with the service dropdown already set is a normal way to ask
  // for "that service, but over there". Every split needs both halves, so this
  // case can only be caught here. The keyword comes back empty for the caller
  // to fill from its own selection.
  //
  // Dangerous when the "place" is actually just a service name: "spa" is also
  // a real, prominent town in Belgium, and geocoding it moved a live search's
  // circle off Rawalpindi and onto Belgium without the user asking for that -
  // a bare word with no "in"/"near"/"," has no location marker in it at all,
  // so there is nothing here that says the user meant a place over a service.
  // Callers that already know the text names a recognised service pass
  // allowWholeQueryFallback: false to keep this from firing.
  if (!value && allowWholeQueryFallback) {
    if (calls++) await sleep(NOMINATIM_GAP_MS);
    const geo = await geocode(q, { strict: true });
    if (geo && geo.importance >= MIN_GUESS_IMPORTANCE) {
      value = pack({ keyword: "", location: q }, geo);
    }
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---- reverse: coordinates -> the name of the place you are standing in ------
//
// "Use my location" on the find form needs a place *name*, not just a pin. The
// nearest warehouse city is not an answer: Pakistan holds three cities, so
// someone in Islamabad would be told they are in Gujrat District, 135km away.
// Nominatim knows the real name, and the live search can then run anywhere
// rather than only where we already have leads.

const revCache = new Map(); // "lat,lng" rounded -> { at, value }

// ~1km of resolution. Fine for a city name, and it makes the cache actually hit
// for a user who clicks the button more than once.
const REV_PRECISION = 2;

// zoom=10 is Nominatim's "city" level. Lower and you get the country, higher
// and you get a street address, which is not what belongs in a lead search.
const REV_ZOOM = 10;

async function reverseGeocode(lat, lng, { timeoutMs = 6000 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = `${lat.toFixed(REV_PRECISION)},${lng.toFixed(REV_PRECISION)}`;
  const hit = revCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=en&zoom=${REV_ZOOM}` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let value = null;
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "leadsfunda/1.0 (lead research tool)" },
    });
    if (res.ok) {
      const r = await res.json();
      const a = r?.address || {};
      // Nominatim names the same administrative level differently depending on
      // the country, so take the first that exists rather than assuming `city`.
      const place =
        a.city ||
        a.town ||
        a.municipality ||
        a.village ||
        a.city_district ||
        a.county ||
        a.state_district ||
        a.state ||
        (r?.display_name || "").split(",")[0] ||
        "";
      if (place) {
        value = {
          place: String(place).trim(),
          display: String(r.display_name || place).trim(),
          countryCode: String(a.country_code || "").toUpperCase(),
          countryName: String(a.country || "").trim(),
          lat: Number(r.lat) || lat,
          lng: Number(r.lon) || lng,
        };
      }
    }
  } catch {
    value = null; // network/timeout: caller falls back to the city dropdown
  } finally {
    clearTimeout(timer);
  }

  if (revCache.size >= CACHE_MAX) revCache.delete(revCache.keys().next().value);
  revCache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { resolveArea, geocode, planGrid, splitCandidates, reverseGeocode };
