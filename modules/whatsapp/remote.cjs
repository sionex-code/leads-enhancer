// WhatsApp-checker module — REMOTE backend. The OpenWA session is heavy and
// stateful, so running it on a dedicated worker (WHATSAPP_WORKER_URL) is a natural
// thing to offload. Only checkNumber + the batch stage cross the wire.
const path = require("path");
const { postJSON } = require("../client.cjs");
const { secretFor, workerUrlFor } = require("../registry.cjs");
const { runRemoteBatch } = require("../shared/batch-remote.cjs");

async function checkNumber(number) {
  const res = await postJSON(workerUrlFor("whatsapp"), "/whatsapp/check", { number }, { secret: secretFor("whatsapp") });
  return res.result || res;
}

// Batch stage: ship the input CSV; whatsapp.js runs --inplace on the worker and the
// modified file comes back, overwriting the project copy.
async function runBatch(ctx) {
  const input = ctx.store.latestInputCsv(ctx.dir);
  if (!input) throw new Error("No CSV found to check on WhatsApp");
  ctx.store.setStage(ctx.dir, "whatsapp", { status: "running", startedAt: new Date().toISOString(), error: "" });
  await runRemoteBatch("whatsapp", "/whatsapp/batch", {
    workerUrl: workerUrlFor("whatsapp"),
    secret: secretFor("whatsapp"),
    params: { concurrency: ctx.value("--whatsappConcurrency", "2") },
    inputs: [{ name: path.basename(input), path: input }],
    destDir: ctx.dir,
    log: ctx.log,
  });
  ctx.store.setStage(ctx.dir, "whatsapp", { status: "done", finishedAt: new Date().toISOString() });
}

module.exports = { checkNumber, runBatch };
