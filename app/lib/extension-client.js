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

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
