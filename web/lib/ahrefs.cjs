// Ahrefs Domain Rating helper. Returns a 0-100 strength score for a domain or
// URL. Free of charge but NOT unauthenticated: Ahrefs now rejects this endpoint
// with 403 unless the request carries an API key, which is why every Domain
// Rating check silently failed until AHREFS_API_KEY was wired up. The key is
// free — create an Ahrefs account, then Account settings → API keys — and goes
// in the VPS .env.local as AHREFS_API_KEY.
//
// Still rate-limited, so callers should cache results on the lead (see
// leads.domain_rating + leads.domain_rating_checked_at) and avoid hammering it.
//
// Docs: https://docs.ahrefs.com/v3-api/public/domain-rating-free
// Use of the data is subject to https://ahrefs.com/legal/domain-rating-license;
// attribution "Domain Rating by Ahrefs" is rendered on the leads page.

const { hostOf } = require("./db.cjs");

const ENDPOINT = "https://api.ahrefs.com/v3/public/domain-rating-free";
const DEFAULT_TIMEOUT_MS = 10000;

// AHREFS_TOKEN accepted as an alias — the docs call it a token, the settings
// screen calls it an API key, and guessing wrong shouldn't cost an afternoon.
const apiKey = () => String(process.env.AHREFS_API_KEY || process.env.AHREFS_TOKEN || "").trim();
const MISSING_KEY =
  "Ahrefs API key not set. Add AHREFS_API_KEY to the server env (free key: Ahrefs account → Account settings → API keys)";

// Normalize an arbitrary website / domain string into the bare hostname
// (lowercased, no scheme/path) the DR endpoint accepts.
function normalizeTarget(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  const host = hostOf(t);
  return host || "";
}

async function fetchDomainRating(rawTarget, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const target = normalizeTarget(rawTarget);
  if (!target) return { ok: false, error: "No domain", target: "" };
  // Fail before the request rather than after 30 identical 403s: without a key
  // there is nothing the endpoint can do for us.
  const key = apiKey();
  if (!key) return { ok: false, error: MISSING_KEY, target, missingKey: true };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${ENDPOINT}?target=${encodeURIComponent(target)}&output=json`;
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      // Say what the status means. "HTTP 403" told nobody that the key was the
      // problem, so the feature just looked broken.
      const reason =
        res.status === 401 || res.status === 403
          ? "Ahrefs rejected the API key (check AHREFS_API_KEY)"
          : res.status === 429
            ? "Ahrefs rate limit reached. Try again shortly"
            : res.status === 400
              // What a dead or malformed domain comes back as. Not a fault worth
              // alarming anyone about: this lead simply has no rating to fetch.
              ? "Ahrefs doesn't recognise this domain"
              : `HTTP ${res.status}`;
      return { ok: false, error: reason, target, status: res.status };
    }
    const data = await res.json().catch(() => null);
    const dr = data && data.domain_rating && typeof data.domain_rating.domain_rating === "number"
      ? data.domain_rating.domain_rating
      : null;
    if (dr == null) return { ok: false, error: "No rating in response", target };
    return { ok: true, target, domain_rating: dr, license: data.domain_rating.license || null };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e);
    return { ok: false, error: msg, target };
  } finally {
    clearTimeout(timer);
  }
}

// Public Ahrefs site-search URL for a given host — linked from the leads page so
// users can confirm the cached DR. Falls back to a plain Google search.
function ahrefsSiteUrl(host) {
  const h = hostOf(host);
  if (!h) return null;
  return `https://ahrefs.com/site-explorer/overview/v2/subdomains?target=${encodeURIComponent(h)}`;
}

module.exports = { fetchDomainRating, normalizeTarget, ahrefsSiteUrl };
