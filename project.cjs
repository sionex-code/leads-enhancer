#!/usr/bin/env node
// Named project runner for the Google Maps lead workflow.
//
// Examples:
//   node project.js scrape "Austin Dentists" --query "dentists in austin" --max 50
//   node project.js enrich "Austin Dentists"
//   node project.js audit "Austin Dentists" --device all
//   node project.js report "Austin Dentists"
//   node project.js resume "Austin Dentists"
//   node project.js delete "Austin Dentists" --yes

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const db = require("./web/lib/db.cjs");
const store = require("./web/lib/store.cjs");

const PROJECT_ROOT = path.join(__dirname, "output", "projects");
const VALUE_FLAGS = new Set([
  "--query",
  "--max",
  "--device",
  "--step",
  "--concurrency",
  "--timeout",
  "--categories",
  "--maxSites",
  "--maxPages",
  "--out",
  "--title",
  "--clickDelay",
  "--closeDelay",
  "--scrollDelay",
  "--scrollAmount",
  "--maxNoCardRounds",
]);

const rawArgs = process.argv.slice(2);
const flags = new Set();
const flagValues = {};
const positionals = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith("--")) {
    flags.add(a);
    if (VALUE_FLAGS.has(a) && rawArgs[i + 1] !== undefined && !rawArgs[i + 1].startsWith("--")) {
      flagValues[a] = rawArgs[++i];
    }
  } else positionals.push(a);
}

const command = (positionals.shift() || "").toLowerCase();
const flagValue = (name, fallback = "") => (flagValues[name] !== undefined ? flagValues[name] : fallback);

function usage() {
  console.log(`
Usage:
  node project.js list
  node project.js create <project> [--query "search"] [--max N]
  node project.js scrape <project> --query "search" --max N
  node project.js enrich <project>
  node project.js whatsapp <project>
  node project.js audit <project> [--device desktop|mobile|all]
  node project.js report <project>
  node project.js status <project>
  node project.js resume <project> [--step scrape|enrich|whatsapp|audit|report]
  node project.js delete <project> --yes
`);
}

function slugify(s) {
  return (
    String(s || "")
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 70) || "project"
  );
}

function projectName() {
  const name = positionals.join(" ").trim();
  if (!name) {
    usage();
    process.exit(1);
  }
  return name;
}

function projectDir(name) {
  return path.join(PROJECT_ROOT, slugify(name));
}

function metaPath(dir) {
  return path.join(dir, "project.json");
}

function readMeta(dir) {
  const file = metaPath(dir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeMeta(dir, patch) {
  fs.mkdirSync(dir, { recursive: true });
  const current = readMeta(dir);
  const now = new Date().toISOString();
  const meta = {
    ...current,
    ...patch,
    updatedAt: now,
    createdAt: current.createdAt || patch.createdAt || now,
  };
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2) + "\n", "utf8");
  return meta;
}

function filesIn(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile() && predicate(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function latestRawCsv(dir) {
  return filesIn(
    dir,
    (f) =>
      f.toLowerCase().endsWith(".csv") &&
      !f.toLowerCase().includes("-enriched") &&
      !f.toLowerCase().includes("-lighthouse")
  )[0];
}

function latestEnrichedCsv(dir) {
  return filesIn(dir, (f) => f.toLowerCase().endsWith("-enriched.csv"))[0];
}

function latestInputCsv(dir) {
  return latestEnrichedCsv(dir) || latestRawCsv(dir);
}

function summaryPath(input, device) {
  return input.replace(/\.csv$/i, `-lighthouse-${device}.csv`);
}

function reportPath(dir, slug) {
  return path.join(dir, `${slug}-report.html`);
}

function countRows(file) {
  if (!file || !fs.existsSync(file)) return 0;
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return 0;
  return Math.max(0, text.split(/\r?\n/).length - 1);
}

function passValues(names) {
  const args = [];
  for (const name of names) {
    if (flagValues[name] !== undefined) args.push(name, flagValues[name]);
  }
  return args;
}

function passBools(names) {
  return names.filter((name) => flags.has(name));
}

function runScript(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      cwd: __dirname,
      stdio: "inherit",
      windowsHide: false,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

function ensureProject(name) {
  const dir = projectDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const meta = writeMeta(dir, { name, slug: slugify(name) });
  return { dir, meta };
}

function existingProject(name) {
  const dir = projectDir(name);
  if (!fs.existsSync(dir)) {
    console.error(`  Project not found: ${name}`);
    process.exit(1);
  }
  return { dir, meta: readMeta(dir) };
}

async function createProject(name) {
  const dir = projectDir(name);
  const query = flagValue("--query", "");
  const max = flagValue("--max", "");
  const meta = writeMeta(dir, {
    name,
    slug: slugify(name),
    query: query || readMeta(dir).query || "",
    max: max || readMeta(dir).max || "",
  });
  console.log(`\n  Project: ${meta.name}`);
  console.log(`  Folder : ${dir}`);
  if (meta.query) console.log(`  Query  : ${meta.query}`);
  if (meta.max) console.log(`  Max    : ${meta.max}`);
}

async function scrapeProject(name) {
  const { dir } = ensureProject(name);
  const current = readMeta(dir);
  const query = flagValue("--query", current.query || "");
  const max = flagValue("--max", current.max || "");
  if (!query) {
    console.error("  Missing query. Use --query \"business type city\" the first time you scrape this project.");
    process.exit(1);
  }
  writeMeta(dir, { name, slug: slugify(name), query, max });
  const args = [query, "--outDir", dir];
  if (max) args.push("--max", max);

  // Auto-rotate Gmail accounts (same pool as the web UI): pick the least-recently
  // used account and pass its cookies so repeated/parallel scrapes spread out.
  try {
    const account = db.nextAccount();
    if (account && account.cookies && account.cookies.length) {
      const cookieFile = path.join(dir, "account-cookies.json");
      fs.writeFileSync(cookieFile, JSON.stringify(account.cookies, null, 2), "utf8");
      args.push("--cookies", cookieFile);
      console.log(`  Account: ${account.name} (rotated)`);
    }
  } catch (err) {
    console.warn(`  Account rotation skipped: ${err.message}`);
  }

  args.push(...passValues(["--clickDelay", "--closeDelay", "--scrollDelay", "--scrollAmount", "--maxNoCardRounds"]));
  args.push(...passBools(["--headless"]));
  await runScript("scrape.js", args);
  syncDb(name);
}

// Merge this project's CSVs into the global deduped leads DB. Best-effort.
function syncDb(name) {
  try {
    const res = store.syncProjectToDb(name);
    console.log(`  Leads DB: +${res.inserted} new, ${res.updated} updated`);
  } catch (err) {
    console.warn(`  Leads DB sync skipped: ${err.message}`);
  }
}

async function enrichProject(name) {
  const { dir } = existingProject(name);
  const input = latestRawCsv(dir);
  if (!input) {
    console.error("  No scrape CSV found for this project yet.");
    process.exit(1);
  }
  const args = [input, ...passValues(["--concurrency", "--maxPages", "--timeout"]), ...passBools(["--watch", "--force"])];
  await runScript("enrich.js", args);
  syncDb(name);
}

async function whatsappProject(name) {
  const { dir } = existingProject(name);
  const input = latestInputCsv(dir);
  if (!input) {
    console.error("  No lead CSV found for this project yet.");
    process.exit(1);
  }
  // Write the whatsapp columns back into the enriched CSV so the report/DB pick them up.
  const args = [
    input,
    "--inplace",
    ...passValues(["--concurrency", "--timeout", "--apiUrl", "--sessionId", "--apiKey", "--region"]),
    ...passBools(["--force"]),
  ];
  await runScript("whatsapp.js", args);
  syncDb(name);
}

function requestedDevices(defaultDevice = "all") {
  const raw = flagValue(
    "--device",
    flags.has("--mobile") ? "mobile" : flags.has("--desktop") ? "desktop" : flags.has("--all") ? "all" : defaultDevice
  ).toLowerCase();
  if (raw === "all" || raw === "both") return ["desktop", "mobile"];
  if (raw === "desktop" || raw === "mobile") return [raw];
  console.error("  Invalid --device. Use desktop, mobile, or all.");
  process.exit(1);
}

async function auditProject(name, defaultDevice = "all") {
  const { dir } = existingProject(name);
  const input = latestInputCsv(dir);
  if (!input) {
    console.error("  No lead CSV found for this project yet.");
    process.exit(1);
  }
  for (const device of requestedDevices(defaultDevice)) {
    const args = [
      input,
      "--device",
      device,
      "--outDir",
      path.join(dir, "lighthouse", device),
      "--summary",
      summaryPath(input, device),
      ...passValues(["--concurrency", "--timeout", "--categories", "--maxSites"]),
      ...passBools(["--force"]),
    ];
    await runScript("analyze.js", args);
  }
  syncDb(name);
}

async function reportProject(name) {
  const { dir, meta } = existingProject(name);
  const input = latestInputCsv(dir);
  if (!input) {
    console.error("  No lead CSV found for this project yet.");
    process.exit(1);
  }
  const desktop = summaryPath(input, "desktop");
  const mobile = summaryPath(input, "mobile");
  const out = path.resolve(flagValue("--out", reportPath(dir, slugify(meta.name || name))));
  const args = [input, "--out", out, "--title", flagValue("--title", meta.name || name)];
  if (fs.existsSync(desktop)) args.push("--desktopLighthouse", desktop);
  if (fs.existsSync(mobile)) args.push("--mobileLighthouse", mobile);
  await runScript("report.js", args);
}

function statusProject(name) {
  const { dir, meta } = existingProject(name);
  const raw = latestRawCsv(dir);
  const enriched = latestEnrichedCsv(dir);
  const input = latestInputCsv(dir);
  const desktop = input ? summaryPath(input, "desktop") : "";
  const mobile = input ? summaryPath(input, "mobile") : "";
  const report = reportPath(dir, slugify(meta.name || name));
  console.log(`\n  Project : ${meta.name || name}`);
  console.log(`  Folder  : ${dir}`);
  if (meta.query) console.log(`  Query   : ${meta.query}`);
  if (meta.max) console.log(`  Target  : ${meta.max}`);
  console.log(`  Raw CSV : ${raw ? `${path.basename(raw)} (${countRows(raw)} rows)` : "none"}`);
  console.log(`  Enriched: ${enriched ? `${path.basename(enriched)} (${countRows(enriched)} rows)` : "none"}`);
  console.log(`  Desktop : ${desktop && fs.existsSync(desktop) ? path.basename(desktop) : "not audited"}`);
  console.log(`  Mobile  : ${mobile && fs.existsSync(mobile) ? path.basename(mobile) : "not audited"}`);
  console.log(`  Report  : ${fs.existsSync(report) ? report : "not generated"}\n`);
}

async function resumeProject(name) {
  const step = flagValue("--step", "").toLowerCase();
  if (step === "scrape") return scrapeProject(name);
  if (step === "enrich") return enrichProject(name);
  if (step === "whatsapp" || step === "wa") return whatsappProject(name);
  if (step === "audit") return auditProject(name);
  if (step === "report") return reportProject(name);
  if (step) {
    console.error("  Invalid --step. Use scrape, enrich, whatsapp, audit, or report.");
    process.exit(1);
  }

  const { dir } = existingProject(name);
  const raw = latestRawCsv(dir);
  const enriched = latestEnrichedCsv(dir);
  if (!raw) return scrapeProject(name);
  if (!enriched || fs.statSync(enriched).mtimeMs < fs.statSync(raw).mtimeMs) return enrichProject(name);

  const waState = enriched.replace(/\.csv$/i, ".whatsapp-state.jsonl");
  if (!fs.existsSync(waState)) return whatsappProject(name);

  const desktop = summaryPath(enriched, "desktop");
  const mobile = summaryPath(enriched, "mobile");
  if (!fs.existsSync(desktop) || !fs.existsSync(mobile)) return auditProject(name);

  const report = reportPath(dir, slugify(readMeta(dir).name || name));
  if (!fs.existsSync(report)) return reportProject(name);
  statusProject(name);
}

function listProjects() {
  fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  const dirs = fs.readdirSync(PROJECT_ROOT).map((d) => path.join(PROJECT_ROOT, d)).filter((d) => fs.statSync(d).isDirectory());
  if (!dirs.length) {
    console.log("\n  No projects yet.\n");
    return;
  }
  console.log("");
  for (const dir of dirs) {
    const meta = readMeta(dir);
    const input = latestInputCsv(dir);
    console.log(`  ${meta.name || path.basename(dir)}  ->  ${input ? path.basename(input) : "no CSV yet"}`);
  }
  console.log("");
}

function deleteProject(name) {
  const dir = projectDir(name);
  if (!fs.existsSync(dir)) {
    console.log(`\n  Project not found: ${name}\n`);
    return;
  }
  if (!flags.has("--yes")) {
    console.error(`  Refusing to delete without --yes: node project.js delete "${name}" --yes`);
    process.exit(1);
  }
  const root = path.resolve(PROJECT_ROOT) + path.sep;
  const target = path.resolve(dir);
  if (!target.startsWith(root)) {
    console.error("  Refusing to delete outside the projects folder.");
    process.exit(1);
  }
  fs.rmSync(target, { recursive: true, force: false });
  console.log(`\n  Deleted project: ${name}\n`);
}

(async () => {
  if (flags.has("--help") || rawArgs.includes("-h") || !command) {
    usage();
    return;
  }
  if (command === "list") return listProjects();

  const name = projectName();
  if (command === "create" || command === "new") return createProject(name);
  if (command === "scrape") return scrapeProject(name);
  if (command === "enrich") return enrichProject(name);
  if (command === "whatsapp" || command === "wa") return whatsappProject(name);
  if (command === "audit" || command === "analyze") return auditProject(name);
  if (command === "report") return reportProject(name);
  if (command === "status") return statusProject(name);
  if (command === "resume") return resumeProject(name);
  if (command === "delete" || command === "remove") return deleteProject(name);

  usage();
  process.exit(1);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
