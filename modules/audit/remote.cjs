// Website-audit module — REMOTE backend. Offloads the heavy real-Chrome work to a
// worker (AUDIT_WORKER_URL). The per-URL scan and the analyze batch cross the wire;
// report.js HTML assembly stays local (it just reads the summaries we get back).
const path = require("path");
const { postJSON } = require("../client.cjs");
const { secretFor, workerUrlFor } = require("../registry.cjs");
const { runRemoteBatch } = require("../shared/batch-remote.cjs");
const local = require("./local.cjs");

// Per-URL scan over HTTP. The shared `browser` handle can't travel, so the worker
// launches its own Chrome; everything else (mobile/timeout) is forwarded.
async function audit(url, opts = {}) {
  const { mobile = false, timeout = 45000 } = opts || {};
  const res = await postJSON(workerUrlFor("audit"), "/audit/url", { url, mobile, timeout }, { secret: secretFor("audit") });
  return res.result || res;
}

// Audit batch stage: ship the input CSV; the worker runs analyze.js per device and
// returns the lighthouse-summary CSVs into the project dir.
async function runBatch(ctx) {
  const input = ctx.store.latestInputCsv(ctx.dir);
  if (!input) throw new Error("No CSV found to audit");
  const devices = local.devicesFor(ctx);
  for (const device of devices) {
    ctx.store.setStage(ctx.dir, `audit-${device}`, { status: "running", startedAt: new Date().toISOString(), error: "" });
  }
  await runRemoteBatch("audit", "/audit/batch", {
    workerUrl: workerUrlFor("audit"),
    secret: secretFor("audit"),
    params: { devices, concurrency: ctx.value("--auditConcurrency", "2") },
    inputs: [{ name: path.basename(input), path: input }],
    destDir: ctx.dir,
    log: ctx.log,
  });
  for (const device of devices) {
    ctx.store.setStage(ctx.dir, `audit-${device}`, { status: "done", finishedAt: new Date().toISOString() });
  }
}

module.exports = { audit, runBatch };
