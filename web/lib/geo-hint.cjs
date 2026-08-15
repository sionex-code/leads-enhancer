"use strict";

// Where the visitor probably is, from the request alone.
//
// Prod sits behind Cloudflare, which stamps `CF-IPCountry` on every request, so
// this costs nothing: no lookup, no dependency, no extra round trip. It exists
// because the find-leads form used to open on the United States for everyone,
// which meant a user in Islamabad started every session by undoing our guess.
//
// This is a *hint*, not a fact. It seeds a dropdown the user can change; it must
// never be used to filter results or make a billing decision.

// Cloudflare uses XX when it cannot place the address and T1 for Tor exits.
// Both mean "no idea", and guessing from them is worse than falling back.
const UNKNOWN = new Set(["XX", "T1", "", "ZZ"]);

function clean(code) {
  const cc = String(code || "").trim().toUpperCase();
  if (cc.length !== 2 || UNKNOWN.has(cc)) return "";
  return cc;
}

// `en-PK,en;q=0.9,ur;q=0.8` -> PK. Only a region subtag counts: a bare "en"
// says nothing about where someone is.
function countryFromAcceptLanguage(value) {
  for (const part of String(value || "").split(",")) {
    const tag = part.split(";")[0].trim();
    const region = tag.split("-")[1];
    const cc = clean(region);
    if (cc) return cc;
  }
  return "";
}

// `headers` is anything with a .get(name) - a Next.js ReadonlyHeaders or a plain
// Request's headers both work.
function countryFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return "";
  const h = (name) => headers.get(name) || "";
  return (
    clean(h("cf-ipcountry")) ||
    clean(h("x-vercel-ip-country")) ||
    clean(h("x-geo-country")) ||
    countryFromAcceptLanguage(h("accept-language")) ||
    ""
  );
}

// Where the visitor is, to city level, when the edge tells us.
//
// Cloudflare's "Add visitor location headers" managed transform adds cf-ipcity,
// cf-iplatitude and cf-iplongitude alongside cf-ipcountry. It is available on
// every plan including Free, but it is OFF by default - so this returns country
// only until it is switched on in the Cloudflare dashboard
// (Rules -> Settings -> Managed Transforms -> Add visitor location headers).
// Everything downstream treats the city as optional for exactly that reason.
//
// Never a fact, always a hint: it seeds a form the user can change, and must
// not filter results or drive a billing decision.
function locationFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return { countryCode: "", city: "", lat: null, lng: null };
  const h = (name) => headers.get(name) || "";
  // Number("") is 0, which is a real coordinate in the Atlantic - an absent
  // header must read as absent, not as null island.
  const num = (v) => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // Vercel percent-encodes the city ("New%20York"); Cloudflare sends it plain.
  const decode = (v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const lat = num(h("cf-iplatitude")) ?? num(h("x-vercel-ip-latitude"));
  const lng = num(h("cf-iplongitude")) ?? num(h("x-vercel-ip-longitude"));
  return {
    countryCode: countryFromHeaders(headers),
    city: decode(h("cf-ipcity") || h("x-vercel-ip-city")).trim(),
    lat,
    lng,
  };
}

// ---- IP lookup, for when the edge does not tell us ------------------------
//
// Cloudflare's location headers are free and instant, but the managed transform
// that adds them is off by default and can only be switched on from the
// dashboard. Rather than have the product depend on a setting nobody can change
// from here, fall back to resolving the visitor's IP directly.
//
// ipwho.is is keyless and HTTPS. The result is cached per IP, so a returning
// visitor costs nothing, and the whole thing is best-effort: a slow or failed
// lookup degrades to the country hint rather than delaying the page.

const IP_CACHE = new Map(); // ip -> { value, expires }
const IP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IP_CACHE_MAX = 5000;
const LOOKUP_TIMEOUT_MS = 2000;

// Loopback, RFC1918, link-local, CGNAT and IPv6 local. A lookup on any of these
// tells us about the server, not the visitor.
const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

// Cloudflare always sends cf-connecting-ip, whatever the location transform is
// set to. x-forwarded-for is the general case: its first entry is the client.
function clientIp(headers) {
  if (!headers || typeof headers.get !== "function") return "";
  const direct = (headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "").trim();
  if (direct) return direct;
  const fwd = headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || "").trim();
}

function cacheGet(ip) {
  const hit = IP_CACHE.get(ip);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    IP_CACHE.delete(ip);
    return null;
  }
  return hit.value;
}

function cacheSet(ip, value) {
  if (IP_CACHE.size >= IP_CACHE_MAX) IP_CACHE.delete(IP_CACHE.keys().next().value);
  IP_CACHE.set(ip, { value, expires: Date.now() + IP_CACHE_TTL_MS });
}

async function lookupIp(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,city,latitude,longitude`,
      { signal: controller.signal, headers: { accept: "application/json" } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.success === false) return null;
    const cc = clean(d.country_code);
    if (!cc) return null;
    return {
      countryCode: cc,
      city: String(d.city || "").trim(),
      lat: Number.isFinite(Number(d.latitude)) ? Number(d.latitude) : null,
      lng: Number.isFinite(Number(d.longitude)) ? Number(d.longitude) : null,
    };
  } catch {
    // Aborted, offline, rate-limited, malformed - all the same answer here.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The visitor's location, from the edge when it offers one and from their IP
// when it does not. Never throws, never blocks for longer than the timeout.
async function resolveLocation(headers) {
  const fromHeaders = locationFromHeaders(headers);
  // The edge already knows: nothing to look up.
  if (fromHeaders.city || (fromHeaders.lat != null && fromHeaders.lng != null)) {
    return { ...fromHeaders, source: "edge" };
  }
  if (process.env.GEO_IP_LOOKUP === "0") return { ...fromHeaders, source: "disabled" };

  const ip = clientIp(headers);
  if (!ip || PRIVATE_IP.test(ip)) return { ...fromHeaders, source: "none" };

  const cached = cacheGet(ip);
  if (cached) return { ...cached, source: "ip-cache" };

  const found = await lookupIp(ip);
  if (!found) return { ...fromHeaders, source: "lookup-failed" };
  cacheSet(ip, found);
  // The edge's country code is authoritative when present; the lookup fills the
  // rest in.
  return { ...found, countryCode: fromHeaders.countryCode || found.countryCode, source: "ip" };
}

module.exports = {
  countryFromHeaders,
  countryFromAcceptLanguage,
  locationFromHeaders,
  resolveLocation,
  clientIp,
  clean,
};
