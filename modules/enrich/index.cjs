// Email-enrichment module — public entry point. Every call site imports THIS file
// (never enrich.cjs directly) so the backend can be swapped local↔remote per the
// ENRICH_WORKER_URL config, with zero changes at the call site.
const { isRemote } = require("../registry.cjs");
const local = require("./local.cjs");
const remote = require("./remote.cjs");

const backend = () => (isRemote("enrich") ? remote : local);

module.exports = {
  // Dispatched (local in-process by default, remote worker when configured):
  enrichSite: (website) => backend().enrichSite(website),
  runBatch: (ctx) => backend().runBatch(ctx),
  // Always local: closeBrowser tears down the in-process browser; runFile is the
  // file-level core the worker itself invokes (never remoted again).
  closeBrowser: local.closeBrowser,
  runFile: local.runFile,
};
