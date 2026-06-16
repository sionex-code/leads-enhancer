// Scraper proxy pool helper. Shared by the grid scraper, the website enricher and
// the browser scraper so Maps / website requests rotate across the admin-managed
// proxy list (random pick) instead of hammering one IP.
//
// Source priority for the proxy list:
//   1. process.env.GMAPS_PROXIES  (newline/comma separated) — explicit override,
//      and the path for the standalone CLI / desktop build where there's no DB.
//   2. the `proxies` table (enabled rows) via web/lib/db.cjs — best effort; if the
//      DB / DATABASE_URL isn't reachable we just fall back to direct connections.
// The resolved list is cached briefly so a short scraper run hits the DB once.

let _cache = { urls: [], at: 0 };
const TTL_MS = 60_000;

function fromEnv() {
  return String(process.env.GMAPS_PROXIES || "")
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadProxyUrls() {
  const envList = fromEnv();
  if (envList.length) return envList;
  if (Date.now() - _cache.at < TTL_MS) return _cache.urls;
  let urls = [];
  try {
    urls = await require("./db.cjs").listEnabledProxyUrls();
  } catch {
    urls = [];
  }
  _cache = { urls, at: Date.now() };
  return urls;
}

function pickRandom(urls) {
  if (!urls || !urls.length) return null;
  return urls[Math.floor(Math.random() * urls.length)];
}

// undici ProxyAgent, cached per proxy url. Returns null when there's no proxy or
// undici isn't available (then fetch goes direct).
const _agents = new Map();
function proxyDispatcher(url) {
  if (!url) return null;
  if (_agents.has(url)) return _agents.get(url);
  let agent = null;
  try {
    const { ProxyAgent } = require("undici");
    agent = new ProxyAgent(url);
  } catch {
    agent = null;
  }
  _agents.set(url, agent);
  return agent;
}

// A random fetch dispatcher for this request: { dispatcher, url }. dispatcher is
// null when no proxies are configured.
async function randomDispatcher() {
  const url = pickRandom(await loadProxyUrls());
  return { dispatcher: proxyDispatcher(url), url };
}

// Split a proxy url into Playwright's { server, username, password } shape (auth
// can't live in the server url for Playwright). Returns null when no url.
function parseForPlaywright(url) {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
    const proxy = { server: `${u.protocol}//${u.host}` };
    if (u.username) proxy.username = decodeURIComponent(u.username);
    if (u.password) proxy.password = decodeURIComponent(u.password);
    return proxy;
  } catch {
    return null;
  }
}

// One random proxy for a browser launch (browsers can't rotate per-request).
async function randomPlaywrightProxy() {
  return parseForPlaywright(pickRandom(await loadProxyUrls()));
}

module.exports = {
  loadProxyUrls,
  pickRandom,
  proxyDispatcher,
  randomDispatcher,
  parseForPlaywright,
  randomPlaywrightProxy,
};
