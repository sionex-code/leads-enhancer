// Website-audit / report module — public entry point. Call sites (web-runner and
// web/lib/site-report.cjs) import THIS file. `auditUrl` is a drop-in for
// web-audit.cjs#auditUrl so the heavy scan offloads when AUDIT_WORKER_URL is set;
// runReport stays local because it only assembles HTML from local summaries.
const { isRemote } = require("../registry.cjs");
const local = require("./local.cjs");
const remote = require("./remote.cjs");

const backend = () => (isRemote("audit") ? remote : local);

module.exports = {
  auditUrl: (url, opts) => backend().audit(url, opts),
  runBatch: (ctx) => backend().runBatch(ctx),
  runReport: (ctx) => local.runReport(ctx), // always local
  runFile: local.runFile,
};
