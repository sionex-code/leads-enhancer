// WhatsApp-checker module — LOCAL backend. Wraps whatsapp.cjs (the OpenWA client)
// and the project-aware batch stage that used to live inline in web-runner.cjs.
const path = require("path");
const waCjs = require("../../whatsapp.cjs");
const { runProcess, runNodeStage } = require("../shared/spawn.cjs");

// Per-lead check against the OpenWA instance. Returns { exists, whatsappId, status }.
function checkNumber(number) {
  return waCjs.checkNumber(number);
}

// Project-aware batch stage (web-runner local path). Identical to the former
// web-runner.runWhatsapp: check every phone on the enriched CSV (falls back to raw),
// writing the whatsapp columns back in place.
async function runBatch(ctx) {
  const input = ctx.store.latestInputCsv(ctx.dir);
  if (!input) throw new Error("No CSV found to check on WhatsApp");
  const concurrency = ctx.value("--whatsappConcurrency", "2");
  const args = [input, "--inplace", "--concurrency", concurrency];
  await runNodeStage(ctx, "whatsapp", "whatsapp.js", path.join(ctx.dir, "whatsapp.log"), args);
}

// File-level run used by the worker: check `inputPath` in place.
async function runFile({ ROOT, inputPath, params = {}, logFile }) {
  const concurrency = String(params.concurrency || "2");
  const log = logFile || path.join(path.dirname(inputPath), "whatsapp.log");
  await runProcess("whatsapp", log, [path.join(ROOT, "whatsapp.js"), inputPath, "--inplace", "--concurrency", concurrency], { cwd: ROOT });
}

module.exports = {
  checkNumber,
  normalizePhone: waCjs.normalizePhone, // pure — always local
  dialingCode: waCjs.dialingCode, // pure — always local
  runBatch,
  runFile,
};
