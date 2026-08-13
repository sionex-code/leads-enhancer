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

// `headers` is anything with a .get(name) — a Next.js ReadonlyHeaders or a plain
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
// every plan including Free, but it is OFF by default — so this returns country
// only until it is switched on in the Cloudflare dashboard
// (Rules -> Settings -> Managed Transforms -> Add visitor location headers).
// Everything downstream treats the city as optional for exactly that reason.
//
// Never a fact, always a hint: it seeds a form the user can change, and must
// not filter results or drive a billing decision.
function locationFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return { countryCode: "", city: "", lat: null, lng: null };
  const h = (name) => headers.get(name) || "";
  // Number("") is 0, which is a real coordinate in the Atlantic — an absent
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

module.exports = { countryFromHeaders, countryFromAcceptLanguage, locationFromHeaders, clean };
