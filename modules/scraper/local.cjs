// Map-scraper module — LOCAL backend. Owns the gridscrape→scrape fallback that used
// to live inline in web-runner.runScrape, plus a worker-side `runScrapeToDir` core.
const fs = require("fs");
const path = require("path");
const { runProcess, commandExists } = require("../shared/spawn.cjs");

// Newest non-enriched, non-lighthouse CSV in `dir` (mirrors store.latestRawCsv).
function findRawCsv(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const csvs = names
    .filter((f) => {
      const l = f.toLowerCase();
      return l.endsWith(".csv") && !l.includes("-enriched") && !l.includes("-lighthouse");
    })
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return csvs[0] || null;
}

// Project-aware SCRAPE stage (web-runner local path). Faithful to the former
// web-runner.runScrape: grid HTTP scraper first, browser scraper on exit-code-3
// (no geocodable location) or for direct Maps URLs / --dom.
async function runBatch(ctx) {
  const meta = ctx.store.readMeta(ctx.dir);
  const query = ctx.value("--query", meta.query || "");
  const max = ctx.value("--max", meta.max || "");
  if (!query) throw new Error("Scrape needs a query");
  ctx.store.writeMeta(ctx.dir, { name: ctx.projectName, slug: ctx.store.slugify(ctx.projectName), query, max });
  const stageLog = path.join(ctx.dir, "scrape.log");

  if (!ctx.flags.has("--dom") && !/^https?:\/\//i.test(query)) {
    ctx.store.setStage(ctx.dir, "scrape", { status: "running", startedAt: new Date().toISOString(), error: "" });
    const gridArgs = [path.join(ctx.ROOT, "gridscrape.js"), query, "--outDir", ctx.dir, "--project", ctx.projectName];
    if (max) gridArgs.push("--max", max);
    try {
      await runProcess("scrape", stageLog, gridArgs, { cwd: ctx.ROOT, label: `node gridscrape.js "${query}" --max ${max || "unlimited"}` });
      ctx.store.setStage(ctx.dir, "scrape", { status: "done", finishedAt: new Date().toISOString() });
      return;
    } catch (err) {
      if (!/exited with code 3/.test(err.message)) throw err;
      ctx.log("Grid scrape can't geocode this query — falling back to browser scraper");
    }
  }

  const args = [path.join(ctx.ROOT, "scrape.js"), query, "--outDir", ctx.dir, "--profileDir", path.join(ctx.dir, "browser-profile")];
  if (max) args.push("--max", max);
  if (ctx.flags.has("--dom")) args.push("--dom");
  else args.push("--network");
  if (ctx.flags.has("--blockCanvas")) args.push("--blockCanvas");
  if (ctx.flags.has("--allowImages")) args.push("--allowImages");

  ctx.store.setStage(ctx.dir, "scrape", { status: "running", startedAt: new Date().toISOString(), error: "" });
  const useHeadless = ctx.flags.has("--headless") || (process.platform !== "win32" && !commandExists("xvfb-run"));
  if (useHeadless) args.push("--headless");

  if (process.platform !== "win32" && !useHeadless && commandExists("xvfb-run")) {
    await runProcess("scrape", stageLog, ["-a", process.execPath, ...args], { command: "xvfb-run", cwd: ctx.ROOT, label: `xvfb-run -a node scrape.js "${query}" --max ${max || "unlimited"}` });
  } else {
    await runProcess("scrape", stageLog, args, { command: process.execPath, cwd: ctx.ROOT, label: `node scrape.js "${query}" --max ${max || "unlimited"}${useHeadless ? " --headless" : ""}` });
  }
  ctx.store.setStage(ctx.dir, "scrape", { status: "done", finishedAt: new Date().toISOString() });
}

// Worker-side core: run a scrape into `outDir`, passing the owning user's id in the
// env so gridscrape upserts to the SHARED leads DB in realtime. Returns the produced
// raw CSV path (the app writes it into the project dir for downstream stages).
async function runScrapeToDir({ ROOT, query, max, outDir, project, userId, mode = "network", blockCanvas = false, allowImages = false, headless = true, log = () => {} }) {
  if (!query) throw new Error("Scrape needs a query");
  fs.mkdirSync(outDir, { recursive: true });
  const stageLog = path.join(outDir, "scrape.log");
  const env = userId ? { GMAPS_USER_ID: String(userId) } : {};
  const isUrl = /^https?:\/\//i.test(query);

  if (mode !== "dom" && !isUrl) {
    const gridArgs = [path.join(ROOT, "gridscrape.js"), query, "--outDir", outDir, "--project", project || "remote"];
    if (max) gridArgs.push("--max", String(max));
    try {
      await runProcess("scrape", stageLog, gridArgs, { cwd: ROOT, env, label: `node gridscrape.js "${query}"` });
      return findRawCsv(outDir);
    } catch (err) {
      if (!/exited with code 3/.test(err.message)) throw err;
      log("Grid scrape can't geocode this query — falling back to browser scraper");
    }
  }

  const args = [path.join(ROOT, "scrape.js"), query, "--outDir", outDir, "--profileDir", path.join(outDir, "browser-profile")];
  if (max) args.push("--max", String(max));
  args.push(mode === "dom" ? "--dom" : "--network");
  if (blockCanvas) args.push("--blockCanvas");
  if (allowImages) args.push("--allowImages");
  const useHeadless = headless || (process.platform !== "win32" && !commandExists("xvfb-run"));
  if (useHeadless) args.push("--headless");

  if (process.platform !== "win32" && !useHeadless && commandExists("xvfb-run")) {
    await runProcess("scrape", stageLog, ["-a", process.execPath, ...args], { command: "xvfb-run", cwd: ROOT, env });
  } else {
    await runProcess("scrape", stageLog, args, { command: process.execPath, cwd: ROOT, env });
  }
  return findRawCsv(outDir);
}

module.exports = { runBatch, runScrapeToDir, findRawCsv };
