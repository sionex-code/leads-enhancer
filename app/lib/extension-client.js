"use client";

// Talks to the LeadsFunda browser extension.
//
// Live search runs in the user's browser rather than on our VPS, so the box
// isn't spending CPU and bandwidth scraping Google Maps for every search. The
// page can't message the extension directly (an unpacked install has a
// different ID on every machine, which `externally_connectable` can't target),
// so we exchange window.postMessage with the extension's content script.

const PAGE_SOURCE = "leadsfunda";
const EXT_SOURCE = "gmaps-ext";
const DETECT_TIMEOUT_MS = 2500;
const PING_RETRY_MS = 300;

let cachedVersion = null;
let cachedLatest = null;

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Compares "2.4.1" >= "2.4.0" numerically, part by part — a plain string
// compare would put "2.10.0" before "2.9.0".
export function versionAtLeast(version, min) {
  const a = String(version || "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(min || "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

// The extension version that first understood the ENRICH_DOMAINS message type
// (Domain Leads Finder). An older, already-installed extension silently drops
// that message — its content-script bridge doesn't forward a type it doesn't
// know — so the page would otherwise wait forever for a RESULT that never
// comes. Anything calling enrichDomains() should check this first.
export const MIN_DOMAIN_FINDER_VERSION = "2.4.0";

// The extension build we currently publish, read from a static file that ships
// with this app (public/extension-version.json).
//
// The zip is uploaded to the VPS by hand, so that file is the one thing that
// has to be bumped alongside it — it's how a page load knows a newer build
// exists. Self-hosted unpacked extensions never auto-update, so without this
// an out-of-date install stays out of date silently until something it can't
// do (see MIN_DOMAIN_FINDER_VERSION) finally fails in the user's face.
export function getLatestExtensionVersion() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (cachedLatest) return Promise.resolve(cachedLatest);
  return fetch("/extension-version.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const v = d?.version || null;
      if (v) cachedLatest = v;
      return v;
    })
    .catch(() => null);
}

// Resolves with the extension version string, or null if it isn't installed.
export function detectExtension({ timeoutMs = DETECT_TIMEOUT_MS } = {}) {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (cachedVersion) return Promise.resolve(cachedVersion);

  return new Promise((resolve) => {
    const requestId = newId();
    let done = false;

    function finish(version) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(retry);
      window.removeEventListener("message", onMessage);
      if (version) cachedVersion = version;
      resolve(version);
    }

    function onMessage(event) {
      if (event.source !== window) return;
      const m = event.data;
      if (!m || m.source !== EXT_SOURCE) return;
      // Accept either the direct reply or the bridge's unsolicited READY.
      if ((m.type === "PONG" && m.requestId === requestId) || m.type === "READY") {
        finish(m.version || "unknown");
      }
    }

    function ping() {
      window.postMessage({ source: PAGE_SOURCE, type: "PING", requestId }, window.location.origin);
    }

    // The content script runs at document_idle, so it may not be listening yet
    // when React first mounts. A single PING would then be dropped, leaving
    // detection to catch the bridge's one-shot READY — a race we'd lose on a
    // slow page. Re-ping until something answers instead.
    const timer = setTimeout(() => finish(null), timeoutMs);
    const retry = setInterval(ping, PING_RETRY_MS);
    window.addEventListener("message", onMessage);
    ping();
  });
}

/**
 * Run a scrape in the extension.
 * @param {object} params  { query, centerLat, centerLng, radiusKm, max, enrich }
 * @param {object} opts    { onProgress({phase,done,total,message}), signal }
 * @returns {Promise<{rows: object[], cancelled: boolean}>}
 */
export function scrapeWithExtension(params, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const jobId = newId();
    let done = false;

    function cleanup() {
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener?.("abort", onAbort);
    }

    function onAbort() {
      window.postMessage({ source: PAGE_SOURCE, type: "CANCEL", jobId }, window.location.origin);
    }

    function onMessage(event) {
      if (event.source !== window) return;
      const m = event.data;
      if (!m || m.source !== EXT_SOURCE || m.jobId !== jobId) return;

      if (m.type === "PROGRESS") {
        onProgress?.(m);
        return;
      }
      if (m.type === "RESULT") {
        if (done) return;
        done = true;
        cleanup();
        if (m.ok === false) reject(new Error(m.error || "Extension scrape failed"));
        // `timedOut` means the extension hit its own wall-clock ceiling and
        // returned early. Like a cancel, it still carries real leads, so it is
        // reported alongside them rather than raised as a failure.
        else resolve({ rows: m.rows || [], cancelled: !!m.cancelled, timedOut: !!m.timedOut });
      }
    }

    window.addEventListener("message", onMessage);
    signal?.addEventListener?.("abort", onAbort);
    window.postMessage({ source: PAGE_SOURCE, type: "SCRAPE", jobId, params }, window.location.origin);
  });
}

/**
 * Domain Lead Finder: crawl an arbitrary list of domains in the extension
 * (10s/site timeout, low concurrency — runs in the user's own browser, not
 * the VPS) for emails, socials and tracking pixels.
 * @param {string[]} domains
 * @param {object} opts  { onProgress({phase,done,total}), signal }
 * @returns {Promise<{rows: object[], cancelled: boolean, timedOut: boolean}>}
 */
export function enrichDomains(domains, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const jobId = newId();
    let done = false;

    // A watchdog, not a progress deadline: if nothing EVER answers — most
    // likely an already-installed extension too old to know the
    // ENRICH_DOMAINS message type, which its content-script bridge silently
    // drops rather than erroring — this promise would otherwise hang forever
    // and the page would spin on "Scanning…" with no way out. Generous enough
    // to clear the extension's own internal deadline (60s floor, 15s/domain,
    // capped at 6min) with room for message-passing overhead.
    const watchdogMs = Math.max(60000, Math.min(domains.length * 15000, 360000)) + 30000;
    const watchdog = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      window.postMessage({ source: PAGE_SOURCE, type: "CANCEL", jobId }, window.location.origin);
      reject(new Error(
        "The extension didn't respond. If you already had it installed, reload it at chrome://extensions " +
        "(it may be an older version that doesn't support Domain Leads Finder yet), then try again."
      ));
    }, watchdogMs);

    function cleanup() {
      clearTimeout(watchdog);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener?.("abort", onAbort);
    }

    function onAbort() {
      window.postMessage({ source: PAGE_SOURCE, type: "CANCEL", jobId }, window.location.origin);
    }

    function onMessage(event) {
      if (event.source !== window) return;
      const m = event.data;
      if (!m || m.source !== EXT_SOURCE || m.jobId !== jobId) return;

      if (m.type === "PROGRESS") {
        onProgress?.(m);
        return;
      }
      if (m.type === "RESULT") {
        if (done) return;
        done = true;
        cleanup();
        if (m.ok === false) reject(new Error(m.error || "Extension domain scan failed"));
        else resolve({ rows: m.rows || [], cancelled: !!m.cancelled, timedOut: !!m.timedOut });
      }
    }

    window.addEventListener("message", onMessage);
    signal?.addEventListener?.("abort", onAbort);
    window.postMessage({ source: PAGE_SOURCE, type: "ENRICH_DOMAINS", jobId, domains }, window.location.origin);
  });
}
