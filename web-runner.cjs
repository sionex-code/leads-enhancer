#!/usr/bin/env node
// Background runner used by the Next.js web UI. Each pipeline stage is delegated to
// its capability module under modules/<name>, which runs the work in-process by
// default or on a remote worker VPS when that module's *_WORKER_URL is configured
// (see modules/README.md). This file stays a thin orchestrator: parse args, decide
// which stages to run, build the shared context, loop, and keep the leads DB synced.

const fs = require("fs");
const path = require("path");
const store = require("./web/lib/store.cjs");
const {
  ROOT,
  slugify,
  safeProjectDir,
  writeMeta,
  readMeta,
  readState,
  writeState,
  latestRawCsv,
  latestEnrichedCsv,
  latestInputCsv,
  summaryPath,
  syncProjectToDb,
} = store;

const scraper = require("./modules/scraper/index.cjs");
const enrich = require("./modules/enrich/index.cjs");
const whatsapp = require("./modules/whatsapp/index.cjs");
const audit = require("./modules/audit/index.cjs");

const VALUE_FLAGS = new Set([
  "--project",
  "--stages",
  "--query",
  "--max",
  "--device",
  "--enrichConcurrency",
  "--enrichEngine",
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

// Shared context handed to every module's runBatch/runReport. Modules read project
// state through `store` + `dir`, CLI knobs through `value`/`flags`, and report
// progress through `log`. `userId` tags realtime DB upserts (set by the queue).
const ctx = {
  ROOT,
  dir,
  projectName,
  userId: process.env.GMAPS_USER_ID || null,
  flags,
  value,
  log,
  store,
};

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

// Merge this project's latest CSVs into the global deduped leads DB. Never let a
// sync error abort the run — the CSVs remain the source of truth.
async function syncDb(stage) {
  try {
    const res = await syncProjectToDb(projectName);
    log(`DB sync: +${res.inserted} new, ${res.updated} updated`);
    // Record the new-vs-duplicate split so the dashboard can explain what was charged
    // ("X new · Y already in your leads"). Only the post-scrape sync of the browser
    // path is meaningful here — the grid scraper upserts in realtime and records its
    // own running totals, so its post-scrape sync reports 0 new and is skipped.
    if (stage === "scrape" && res.inserted > 0) {
      writeState(dir, { dbSync: { inserted: res.inserted, updated: res.updated, at: new Date().toISOString() } });
    }
  } catch (err) {
    log(`DB sync failed: ${err.message}`);
  }
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
    if (stage === "scrape") await scraper.runBatch(ctx);
    else if (stage === "enrich") await enrich.runBatch(ctx);
    else if (stage === "whatsapp" || stage === "wa") await whatsapp.runBatch(ctx);
    else if (stage === "audit" || stage === "lighthouse") await audit.runBatch(ctx);
    else if (stage === "report") await audit.runReport(ctx);
    else log(`Skipping unknown stage ${stage}`);
    log(`Finished stage ${stage}`);
    await syncDb(stage); // keep the global leads DB current after every stage
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
