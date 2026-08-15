// One outbound HTTP helper for every CRM adapter.
//
// Same contract as ahrefs.cjs: this never throws. A CRM being down, slow, or
// rude is an expected condition during a 500-lead push, not an exception - the
// runner needs a value it can record against the lead and move on.
const TIMEOUT_MS = 15000;

async function fetchJson(url, { method = "GET", headers = {}, body, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "follow" });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not every CRM answers JSON on an error */ }
    // Retry-After is either seconds or an HTTP date; only the numeric form is
    // worth honouring precisely - a date that far out means give up anyway.
    const raw = res.headers.get("retry-after");
    const retryAfterMs = raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) * 1000 : 0;
    return { ok: res.ok, status: res.status, data, text, retryAfterMs };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === "AbortError" ? "timeout" : String(err?.message || err),
      network: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Turn a status into something a user can act on. "HTTP 401" tells them
// nothing; "reconnect the integration" tells them exactly what to do.
function describe(result, label = "The service") {
  if (result?.error === "timeout") return `${label} did not respond in time.`;
  if (result?.network) return `${label} could not be reached (${result.error}).`;
  const status = result?.status;
  if (status === 401) return `${label} rejected the credentials. Reconnect the integration.`;
  if (status === 403) return `${label} accepted the credentials but refused the request - check the token's permissions.`;
  if (status === 404) return `${label} could not find that record.`;
  if (status === 409) return `${label} reported a conflict with an existing record.`;
  if (status === 429) return `${label} rate limit reached.`;
  if (status === 400 || status === 422) {
    // These carry the useful detail - the CRM is telling us which field it hated.
    const detail = result?.data?.message || result?.data?.error || result?.data?.error_info;
    return `${label} rejected this lead's data${detail ? `: ${String(detail).slice(0, 200)}` : "."}`;
  }
  if (status >= 500) return `${label} is having problems (HTTP ${status}).`;
  return `${label} returned HTTP ${status}.`;
}

// A 4xx that isn't 429 means the request itself is wrong - sending it again
// unchanged just wastes the user's rate limit.
const retryable = (result) => result?.network || result?.status === 429 || result?.status >= 500;

module.exports = { fetchJson, describe, retryable, TIMEOUT_MS };
