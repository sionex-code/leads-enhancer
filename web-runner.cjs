#!/usr/bin/env node
// Background runner used by the Next.js web UI.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  ROOT,
  slugify,
  safeProjectDir,
  writeMeta,
  readMeta,
  readState,
  writeState,
  setStage,
  latestRawCsv,
  latestEnrichedCsv,
  latestInputCsv,
  summaryPath,
  writeRotatedCookies,
  syncProjectToDb,
} = require("./web/lib/store.cjs");

const VALUE_FLAGS = new Set([
  "--project",
  "--stages",
  "--query",
  "--max",
  "--device",
  "--enrichConcurrency",
  "--auditConcurrency",
  "--whatsappConcurrency",
]);

const rawArgs = process.argv.slice(2);
const flags = new Set();
const values = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (!a.startsWith("--")) continue;
  flags.add(a);
  if (VALUE_FLAGS.has(a) && rawArgs[i + 1] !== undefined && !rawArgs[i + 1].startsWith("--")) {
    values[a] = rawArgs[++i];
  }
}

const value = (name, fallback = "") => (values[name] !== undefined ? values[name] : fallback);
const projectName = value("--project");
if (!projectName) {
  console.error("Missing --project");
  process.exit(1);
}

const dir = safeProjectDir(projectName);
fs.mkdirSync(dir, { recursive: true });
const runnerLog = path.join(dir, "web-runner.log");

function log(line) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(runnerLog, `[${stamp}] ${line}\n`, "utf8");
}

function parseStages() {
  const raw = value("--stages", "scrape,enrich,whatsapp,audit").toLowerCase();
  if (raw === "resume") return stagesForResume();
  const stages = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (stages.includes("all")) return ["scrape", "enrich", "whatsapp", "audit", "report"];
  return stages;
}

function requestedDevices() {
  const raw = value("--device", "all").toLowerCase();
  if (raw === "all" || raw === "both") return ["desktop", "mobile"];
  if (raw === "desktop" || raw === "mobile") return [raw];
  return ["desktop", "mobile"];
}

function stagesForResume() {
  const raw = latestRawCsv(dir);
  const enriched = latestEnrichedCsv(dir);
  const input = latestInputCsv(dir);
  if (!raw) return ["scrape", "enrich", "whatsapp", "audit", "report"];
  if (!enriched || fs.statSync(enriched).mtimeMs < fs.statSync(raw).mtimeMs)
    return ["enrich", "whatsapp", "audit", "report"];
  // WhatsApp runs in-place on the enriched CSV; its state file beside that CSV
  // is the marker that it already ran.
  const waState = enriched.replace(/\.csv$/i, ".whatsapp-state.jsonl");
  if (!fs.existsSync(waState)) return ["whatsapp", "audit", "report"];
  const missingAudit =
    !input ||
    !fs.existsSync(summaryPath(input, "desktop")) ||
    !fs.existsSync(summaryPath(input, "mobile"));
  if (missingAudit) return ["audit", "report"];
  const report = path.join(dir, `${slugify(readMeta(dir).name || projectName)}-report.html`);
  if (!fs.existsSync(report)) return ["report"];
  return [];
}

function appendTo(file, chunk) {
  fs.appendFileSync(file, chunk.toString(), "utf8");
}

// Merge this project's latest CSVs into the global deduped leads DB. Never let a
// sync error abort the run — the CSVs remain the source of truth.
function syncDb() {
  try {
    const res = syncProjectToDb(projectName);
    log(`DB sync: +${res.inserted} new, ${res.updated} updated`);
  } catch (err) {
    log(`DB sync failed: ${err.message}`);
  }
}

function commandExists(cmd) {
  const paths = (process.env.PATH || "").split(path.delimiter);
  return paths.some((p) => fs.existsSync(path.join(p, cmd)));
}

function runProcess(stage, logFile, args, options = {}) {
  return new Promise((resolve, reject) => {
    fs.appendFileSync(logFile, `\n$ ${options.label || [process.execPath, ...args].join(" ")}\n`, "utf8");
    const child = spawn(options.command || process.execPath, options.command ? args : args, {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    child.stdout.on("data", (d) => appendTo(logFile, d));
    child.stderr.on("data", (d) => appendTo(logFile, d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${stage} exited with code ${code}`));
    });
  });
}

async function runNode(stage, script, stageLog, args) {
  setStage(dir, stage, { status: "running", startedAt: new Date().toISOString(), error: "" });
  await runProcess(stage, stageLog, [path.join(ROOT, script), ...args]);
  setStage(dir, stage, { status: "done", finishedAt: new Date().toISOString() });
}

async function runScrape() {
  const meta = readMeta(dir);
  const query = value("--query", meta.query || "");
  const max = value("--max", meta.max || "");
  if (!query) throw new Error("Scrape needs a query");
  writeMeta(dir, { name: projectName, slug: slugify(projectName), query, max });

  // Default path: the HTTP grid scraper (no browser). It tiles the geocoded
  // area and hits Maps' internal endpoint directly — far faster, and it appends
  // to the CSV + upserts the leads DB in realtime so counts grow live in the UI.
  // Falls back to the browser scraper for direct Maps URLs, --dom mode, or when
  // the query has no geocodable "<service> in <location>" shape (exit code 3).
  if (!flags.has("--dom") && !/^https?:\/\//i.test(query)) {
    const stageLog = path.join(dir, "scrape.log");
    setStage(dir, "scrape", { status: "running", startedAt: new Date().toISOString(), error: "" });
    const gridArgs = [path.join(ROOT, "gridscrape.js"), query, "--outDir", dir, "--project", projectName];
    if (max) gridArgs.push("--max", max);
    try {
      await runProcess("scrape", stageLog, gridArgs, {
        label: `node gridscrape.js "${query}" --max ${max || "unlimited"}`,
      });
      setStage(dir, "scrape", { status: "done", finishedAt: new Date().toISOString() });
      return;
    } catch (err) {
      if (!/exited with code 3/.test(err.message)) throw err;
      log("Grid scrape can't geocode this query — falling back to browser scraper");
    }
  }

  const args = [path.join(ROOT, "scrape.js"), query, "--outDir", dir, "--profileDir", path.join(dir, "browser-profile")];
  if (max) args.push("--max", max);
  // Forward the capture mode chosen by the UI/caller (defaults to fast network mode).
  if (flags.has("--dom")) args.push("--dom");
  else args.push("--network");
  // Skip map rendering when asked — saves CPU/GPU, harmless to feed + RPC capture.
  if (flags.has("--blockCanvas")) args.push("--blockCanvas");
  // Images are blocked by default; only forward the opt-out.
  if (flags.has("--allowImages")) args.push("--allowImages");

  // Auto-rotate Gmail accounts: each scrape run takes the least-recently-used
  // account from the DB, so concurrent projects sign in with different Gmails.
  try {
    const { file, account } = writeRotatedCookies(projectName);
    if (file) {
      args.push("--cookies", file);
      log(`Using Gmail account: ${account.name} (id ${account.id})`);
    } else {
      log("No Gmail accounts configured — scraping logged out");
    }
  } catch (err) {
    log(`Cookie rotation skipped: ${err.message}`);
  }

  const stageLog = path.join(dir, "scrape.log");
  setStage(dir, "scrape", { status: "running", startedAt: new Date().toISOString(), error: "" });

  const useHeadless = flags.has("--headless") || (process.platform !== "win32" && !commandExists("xvfb-run"));
  if (useHeadless) args.push("--headless");

  if (process.platform !== "win32" && !useHeadless && commandExists("xvfb-run")) {
    await runProcess("scrape", stageLog, ["-a", process.execPath, ...args], {
      command: "xvfb-run",
      label: `xvfb-run -a node scrape.js "${query}" --max ${max || "unlimited"}`,
    });
  } else {
    await runProcess("scrape", stageLog, args, {
      command: process.execPath,
      label: `node scrape.js "${query}" --max ${max || "unlimited"}${useHeadless ? " --headless" : ""}`,
    });
  }

  setStage(dir, "scrape", { status: "done", finishedAt: new Date().toISOString() });
}

async function runEnrich() {
  const input = latestRawCsv(dir);
  if (!input) throw new Error("No scraped CSV found to enrich");
  const concurrency = value("--enrichConcurrency", "16");
  // 15s timeout (plus the in-enricher retry) is far more forgiving of slow
  // small-business sites than the old 10s, which surfaced a lot of "AbortError".
  const args = [input, "--concurrency", concurrency, "--maxPages", "4", "--timeout", "15000"];
  await runNode("enrich", "enrich.js", path.join(dir, "enrich.log"), args);
}

async function runWhatsapp() {
  // Check every lead's phone against WhatsApp. Runs on the enriched CSV (falls
  // back to the raw scrape) and writes the whatsapp columns back in place so the
  // dashboard, DB sync and report all pick them up.
  const input = latestInputCsv(dir);
  if (!input) throw new Error("No CSV found to check on WhatsApp");
  const concurrency = value("--whatsappConcurrency", "2");
  const args = [input, "--inplace", "--concurrency", concurrency];
  // OpenWA connection is taken from env (set in the runner's environment / pm2
  // config); whatsapp.js falls back to its built-in defaults when unset.
  await runNode("whatsapp", "whatsapp.js", path.join(dir, "whatsapp.log"), args);
}

async function runAudit() {
  const input = latestInputCsv(dir);
  if (!input) throw new Error("No CSV found to audit");
  const concurrency = value("--auditConcurrency", "2");
  for (const device of requestedDevices()) {
    const stage = `audit-${device}`;
    const args = [
      input,
      "--device",
      device,
      "--outDir",
      path.join(dir, "lighthouse", device),
      "--summary",
      summaryPath(input, device),
      "--concurrency",
      concurrency,
      "--timeout",
      "120000",
    ];
    await runNode(stage, "analyze.js", path.join(dir, `${stage}.log`), args);
  }
}

async function runReport() {
  const input = latestInputCsv(dir);
  if (!input) throw new Error("No CSV found for report");
  const meta = readMeta(dir);
  const out = path.join(dir, `${slugify(meta.name || projectName)}-report.html`);
  const args = [input, "--out", out, "--title", meta.name || projectName];
  const desktop = summaryPath(input, "desktop");
  const mobile = summaryPath(input, "mobile");
  if (fs.existsSync(desktop)) args.push("--desktopLighthouse", desktop);
  if (fs.existsSync(mobile)) args.push("--mobileLighthouse", mobile);
  await runNode("report", "report.js", path.join(dir, "report.log"), args);
}

(async () => {
  writeMeta(dir, {
    name: projectName,
    slug: slugify(projectName),
    query: value("--query", readMeta(dir).query || ""),
    max: value("--max", readMeta(dir).max || ""),
  });
  writeState(dir, {
    running: true,
    activePid: process.pid,
    message: "Running",
    startedAt: new Date().toISOString(),
  });
  log(`Started runner pid=${process.pid}`);

  const stages = parseStages();
  if (!stages.length) {
    log("Nothing to resume");
    writeState(dir, { running: false, activePid: null, message: "Nothing to resume" });
    return;
  }

  for (const stage of stages) {
    log(`Starting stage ${stage}`);
    if (stage === "scrape") await runScrape();
    else if (stage === "enrich") await runEnrich();
    else if (stage === "whatsapp" || stage === "wa") await runWhatsapp();
    else if (stage === "audit" || stage === "lighthouse") await runAudit();
    else if (stage === "report") await runReport();
    else log(`Skipping unknown stage ${stage}`);
    log(`Finished stage ${stage}`);
    syncDb(); // keep the global leads DB current after every stage
  }

  writeState(dir, {
    running: false,
    activePid: null,
    message: "Done",
    finishedAt: new Date().toISOString(),
  });
  log("Runner complete");
})().catch((err) => {
  log(`ERROR ${err.message}`);
  const state = readState(dir);
  const stages = state.stages || {};
  for (const [name, stage] of Object.entries(stages)) {
    if (stage.status === "running") stages[name] = { ...stage, status: "failed", error: err.message };
  }
  writeState(dir, {
    running: false,
    activePid: null,
    message: `Failed: ${err.message}`,
    stages,
  });
  process.exit(1);
});
