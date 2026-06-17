// Fast website status check — a plain HTTP request (no browser) so the dashboard
// can show each lead's site status (200 / 301 / 404 / 500 / unreachable) quickly
// and in bulk. Tries a GET (some servers reject HEAD) following redirects.

async function checkStatus(rawUrl, { timeoutMs = 12000 } = {}) {
  let url = String(rawUrl || "").trim();
  if (!url) return { status: 0, statusText: "no website", ok: false };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    return {
      status: res.status,
      statusText: res.statusText || "",
      ok: res.ok,
      finalUrl: res.url || url,
    };
  } catch (e) {
    const msg = String(e.message || e);
    const statusText = e.name === "AbortError" ? "timeout" : msg.split("\n")[0].slice(0, 80);
    return { status: 0, statusText, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkStatus };
