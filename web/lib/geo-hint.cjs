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

module.exports = { countryFromHeaders, countryFromAcceptLanguage, clean };
