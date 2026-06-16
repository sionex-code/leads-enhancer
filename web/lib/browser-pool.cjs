// Shared, health-checked Chromium for in-process website work (chatbot scan,
// single-lead enrich, batch scan). Fixes the original leak where each request
// launched its own Chrome (chatbot route) or left a module-level browser open
// forever (enrich.cjs): now there is ONE browser for the whole process, lazily
// launched, re-spawned if it dies, and access is gated so at most N callers use
// it concurrently. Callers borrow it via withBrowser() and must not close it.
const patchright = require("patchright");
const chromium = patchright.chromium;

const MAX_CONCURRENCY = Number(process.env.BROWSER_POOL_CONCURRENCY || 3);
const LAUNCH_ARGS = ["--disable-dev-shm-usage", "--no-sandbox"];

let _browser = null;
let _launching = null;
let _active = 0;
const _waiters = [];

async function launch() {
  return chromium.launch({ channel: "chrome", headless: true, args: LAUNCH_ARGS });
}

// Return a live browser, launching (or relaunching after a crash) as needed.
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  if (_launching) return _launching;
  _launching = (async () => {
    try {
      _browser = await launch();
      _browser.on("disconnected", () => {
        _browser = null;
      });
      return _browser;
    } finally {
      _launching = null;
    }
  })();
  return _launching;
}

function acquireSlot() {
  if (_active < MAX_CONCURRENCY) {
    _active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _waiters.push(resolve));
}

function releaseSlot() {
  const next = _waiters.shift();
  if (next) next();
  else _active = Math.max(0, _active - 1);
}

// Borrow the shared browser for the duration of fn. Concurrency-gated. The
// browser is owned by the pool — do NOT close it inside fn.
async function withBrowser(fn) {
  await acquireSlot();
  try {
    const browser = await getBrowser();
    return await fn(browser);
  } finally {
    releaseSlot();
  }
}

// Close the shared browser (graceful shutdown / tests).
async function closePool() {
  const b = _browser;
  _browser = null;
  if (b) await b.close().catch(() => {});
}

module.exports = { withBrowser, getBrowser, closePool };
