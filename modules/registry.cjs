// Central config for the pluggable-capability modules (scraper / enrich / whatsapp
// / audit). Each module runs **in-process by default** and only switches to a
// remote worker when its `<NAME>_WORKER_URL` env var is set — so a fresh checkout
// behaves exactly as before, and scaling out is purely additive (point a module at
// a worker on another VPS; see modules/README.md).
//
//   SCRAPER_WORKER_URL / ENRICH_WORKER_URL / WHATSAPP_WORKER_URL / AUDIT_WORKER_URL
//   WORKER_SECRET                shared bearer secret (per-module override: <NAME>_WORKER_SECRET)
const MODULES = ["scraper", "enrich", "whatsapp", "audit"];

function workerUrlFor(name) {
  const url = (process.env[`${name.toUpperCase()}_WORKER_URL`] || "").trim();
  return url.replace(/\/+$/, ""); // tolerate a trailing slash in config
}

function secretFor(name) {
  return (process.env[`${name.toUpperCase()}_WORKER_SECRET`] || process.env.WORKER_SECRET || "").trim();
}

// A module is "remote" iff it has a worker URL configured. Otherwise local.
function isRemote(name) {
  return !!workerUrlFor(name);
}

function getModuleConfig(name) {
  const workerUrl = workerUrlFor(name);
  return { name, mode: workerUrl ? "remote" : "local", workerUrl, secret: secretFor(name) };
}

module.exports = { MODULES, isRemote, workerUrlFor, secretFor, getModuleConfig };
