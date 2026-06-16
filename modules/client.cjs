// Minimal JSON-over-HTTP client used by every module's remote backend to reach a
// worker. Dependency-free (global fetch). The shared secret travels in the
// `x-worker-secret` header; worker.cjs rejects any request that doesn't match.
const DEFAULT_TIMEOUT = Number(process.env.WORKER_HTTP_TIMEOUT_MS || 600000); // 10 min — batch scrapes are slow

async function postJSON(workerUrl, route, body, { secret, timeout = DEFAULT_TIMEOUT } = {}) {
  const url = `${String(workerUrl).replace(/\/+$/, "")}${route}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-worker-secret": secret } : {}) },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`worker ${url} unreachable: ${String(err && err.message || err)}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(`worker ${url} -> ${res.status}: ${(data && data.error) || text || res.statusText}`);
  return data;
}

module.exports = { postJSON };
