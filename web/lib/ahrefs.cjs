// Ahrefs Domain Rating (free public endpoint) helper. Returns a 0-100 strength
// score for a domain or URL. The endpoint is unauthenticated and rate-limited,
// so callers should cache results on the lead (see leads.domain_rating +
// leads.domain_rating_checked_at) and avoid hammering it.
//
// Docs: https://docs.ahrefs.com/v3-api/public/domain-rating-free
// Use of the data is subject to https://ahrefs.com/legal/domain-rating-license;
// attribution "Domain Rating by Ahrefs" is rendered on the leads page.

const { hostOf } = require("./db.cjs");

const ENDPOINT = "https://api.ahrefs.com/v3/public/domain-rating-free";
const DEFAULT_TIMEOUT_MS = 10000;

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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${ENDPOINT}?target=${encodeURIComponent(target)}&output=json`;
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, target, status: res.status };
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
