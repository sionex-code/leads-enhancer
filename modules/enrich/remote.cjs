// Email-enrichment module — REMOTE backend. Forwards work to a worker on another
// VPS (ENRICH_WORKER_URL). The leads DB is shared, so only files travel the wire.
const path = require("path");
const { postJSON } = require("../client.cjs");
const { secretFor, workerUrlFor } = require("../registry.cjs");
const { runRemoteBatch } = require("../shared/batch-remote.cjs");

// Per-lead enrichment over HTTP. Returns the same shape as enrich.cjs#enrichSite.
async function enrichSite(website) {
  const res = await postJSON(workerUrlFor("enrich"), "/enrich/site", { website }, { secret: secretFor("enrich") });
  return res.result || res;
}

// Batch stage: ship the latest raw CSV to the worker, get the enriched CSV back
// into the project dir. Stage state mirrors the local path (running → done; a
// throw leaves it "running" for web-runner's top-level catch to mark failed).
async function runBatch(ctx) {
  const input = ctx.store.latestRawCsv(ctx.dir);
  if (!input) throw new Error("No scraped CSV found to enrich");
  ctx.store.setStage(ctx.dir, "enrich", { status: "running", startedAt: new Date().toISOString(), error: "" });
  await runRemoteBatch("enrich", "/enrich/batch", {
    workerUrl: workerUrlFor("enrich"),
    secret: secretFor("enrich"),
    params: { engine: ctx.value("--enrichEngine", "patchright"), concurrency: ctx.value("--enrichConcurrency", "16") },
    inputs: [{ name: path.basename(input), path: input }],
    destDir: ctx.dir,
    log: ctx.log,
  });
  ctx.store.setStage(ctx.dir, "enrich", { status: "done", finishedAt: new Date().toISOString() });
}

module.exports = { enrichSite, runBatch };
