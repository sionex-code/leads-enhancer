// Website-audit / report module — LOCAL backend. Wraps web-audit.cjs (the heavy
// real-Chrome scan) and the project-aware audit + report batch stages that used to
// live inline in web-runner.cjs.
const fs = require("fs");
const path = require("path");
const { auditUrl } = require("../../web/lib/web-audit.cjs");
const { runProcess, runNodeStage } = require("../shared/spawn.cjs");

// Heavy per-URL scan (desktop or mobile). Pass a shared `browser` for concurrency.
function audit(url, opts = {}) {
  return auditUrl(url, opts);
}

// Which devices a run targets — mirrors the former web-runner.requestedDevices.
function devicesFor(ctx) {
  const raw = String(ctx.value("--device", "all")).toLowerCase();
  if (raw === "all" || raw === "both") return ["desktop", "mobile"];
  if (raw === "desktop" || raw === "mobile") return [raw];
  return ["desktop", "mobile"];
}

// The lighthouse-summary CSV path for an input (matches store.summaryPath).
const summaryPathFor = (input, device) => input.replace(/\.csv$/i, `-lighthouse-${device}.csv`);

// Project-aware AUDIT stage (analyze.js per device). Identical to web-runner.runAudit.
async function runBatch(ctx) {
  const input = ctx.store.latestInputCsv(ctx.dir);
  if (!input) throw new Error("No CSV found to audit");
  const concurrency = ctx.value("--auditConcurrency", "2");
  for (const device of devicesFor(ctx)) {
    const stage = `audit-${device}`;
    const args = [
      input, "--device", device,
      "--outDir", path.join(ctx.dir, "lighthouse", device),
      "--summary", ctx.store.summaryPath(input, device),
      "--concurrency", concurrency, "--timeout", "120000",
    ];
    await runNodeStage(ctx, stage, "analyze.js", path.join(ctx.dir, `${stage}.log`), args);
  }
}

// Project-aware REPORT stage (report.js). Always local — it just assembles the HTML
// report from the (now-present) summary CSVs into the project dir.
async function runReport(ctx) {
  const input = ctx.store.latestInputCsv(ctx.dir);
  if (!input) throw new Error("No CSV found for report");
  const meta = ctx.store.readMeta(ctx.dir);
  const out = path.join(ctx.dir, `${ctx.store.slugify(meta.name || ctx.projectName)}-report.html`);
  const args = [input, "--out", out, "--title", meta.name || ctx.projectName];
  const desktop = ctx.store.summaryPath(input, "desktop");
  const mobile = ctx.store.summaryPath(input, "mobile");
  if (fs.existsSync(desktop)) args.push("--desktopLighthouse", desktop);
  if (fs.existsSync(mobile)) args.push("--mobileLighthouse", mobile);
  await runNodeStage(ctx, "report", "report.js", path.join(ctx.dir, "report.log"), args);
}

// File-level run used by the worker: audit `inputPath` for the given devices,
// writing `<base>-lighthouse-<device>.csv` summaries beside it.
async function runFile({ ROOT, inputPath, params = {}, logFile }) {
  const devices = Array.isArray(params.devices) && params.devices.length ? params.devices : ["desktop", "mobile"];
  const concurrency = String(params.concurrency || "2");
  const workDir = path.dirname(inputPath);
  const log = logFile || path.join(workDir, "audit.log");
  for (const device of devices) {
    const args = [
      path.join(ROOT, "analyze.js"), inputPath, "--device", device,
      "--outDir", path.join(workDir, "lighthouse", device),
      "--summary", summaryPathFor(inputPath, device),
      "--concurrency", concurrency, "--timeout", "120000",
    ];
    await runProcess(`audit-${device}`, log, args, { cwd: ROOT });
  }
}

module.exports = { audit, runBatch, runReport, runFile, devicesFor };
