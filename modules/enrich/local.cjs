// Email-enrichment module — LOCAL backend. Wraps the existing enrich.cjs engine
// and the project-aware batch stage that used to live inline in web-runner.cjs.
const path = require("path");
const enrichCjs = require("../../enrich.cjs");
const { runProcess, runNodeStage } = require("../shared/spawn.cjs");

// Per-lead, request/response enrichment (same engine the batch uses).
function enrichSite(website) {
  return enrichCjs.enrichSite(website);
}

// Project-aware batch stage (web-runner local path). Identical behavior to the
// former web-runner.runEnrich: pick the latest raw CSV and run the chosen engine.
async function runBatch(ctx) {
  const input = ctx.store.latestRawCsv(ctx.dir);
  if (!input) throw new Error("No scraped CSV found to enrich");
  const engine = ctx.value("--enrichEngine", "patchright").toLowerCase();
  if (engine === "crawlee") {
    const concurrency = ctx.value("--enrichConcurrency", "30");
    const args = [input, "--concurrency", concurrency, "--timeout", "15000"];
    await runNodeStage(ctx, "enrich", "enrich-crawlee.js", path.join(ctx.dir, "enrich.log"), args);
    return;
  }
  const concurrency = ctx.value("--enrichConcurrency", "16");
  // 15s timeout (plus the in-enricher retry) is forgiving of slow small-biz sites.
  const args = [input, "--concurrency", concurrency, "--maxPages", "4", "--timeout", "15000"];
  await runNodeStage(ctx, "enrich", "enrich.js", path.join(ctx.dir, "enrich.log"), args);
}

// File-level run used by the worker: enrich `inputPath`, producing
// `<base>-enriched.csv` beside it (enrich.cjs's own convention).
async function runFile({ ROOT, inputPath, params = {}, logFile }) {
  const engine = String(params.engine || "patchright").toLowerCase();
  const log = logFile || path.join(path.dirname(inputPath), "enrich.log");
  if (engine === "crawlee") {
    const concurrency = String(params.concurrency || "30");
    await runProcess("enrich", log, [path.join(ROOT, "enrich-crawlee.js"), inputPath, "--concurrency", concurrency, "--timeout", "15000"], { cwd: ROOT });
  } else {
    const concurrency = String(params.concurrency || "16");
    await runProcess("enrich", log, [path.join(ROOT, "enrich.js"), inputPath, "--concurrency", concurrency, "--maxPages", "4", "--timeout", "15000"], { cwd: ROOT });
  }
}

module.exports = { enrichSite, closeBrowser: enrichCjs.closeBrowser, runBatch, runFile };
