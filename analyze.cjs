#!/usr/bin/env node
// Website auditor: runs Google Lighthouse against each lead's website (headless
// Chrome), saving a full HTML + JSON report per site plus a scores summary CSV.
//
// Usage:
//   node analyze.js                                 # latest CSV in ./output (enriched preferred)
//   node analyze.js output/leads-enriched.csv       # specific file
//   node analyze.js output/leads.csv --concurrency 1 --device desktop --outDir output/projects/x/lighthouse/desktop
//
// Resume: every audited site is appended to <outDir>/.analyze-state.jsonl, so
// re-running skips sites already done (use --force to redo). Duplicate domains
// are audited once.
//
// Requires Lighthouse locally or on PATH: npm install

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ---- CLI args ----------------------------------------------------------------
const VALUE_FLAGS = new Set(["--concurrency", "--timeout", "--outDir", "--summary", "--categories", "--device", "--maxSites"]);
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
const flagValue = (name, fallback) => (flagValues[name] !== undefined ? flagValues[name] : fallback);

if (flags.has("--help") || rawArgs.includes("-h")) {
  console.log(`
Usage:
  node analyze.js [leads.csv] [flags]

Flags:
  --device desktop|mobile   Audit device mode. Default: desktop
  --mobile                  Backward-compatible shortcut for --device mobile
  --concurrency N           Lighthouse workers. Default: 2
  --timeout MS              Kill each site after this many ms. Default: 90000
  --outDir DIR              Folder for Lighthouse HTML/JSON reports
  --summary FILE            Summary CSV path
  --categories LIST         Lighthouse categories. Default: performance,accessibility,best-practices,seo
  --maxSites N              Audit only the first N pending sites
  --force                   Ignore saved audit state
`);
  process.exit(0);
}

const CONCURRENCY = Math.max(1, parseInt(flagValue("--concurrency", "2"), 10)); // Lighthouse is heavy
const TIMEOUT = parseInt(flagValue("--timeout", "90000"), 10); // hard kill per site, ms
const FORCE = flags.has("--force");
const DEVICE = (flagValue("--device", flags.has("--mobile") ? "mobile" : "desktop") || "desktop").toLowerCase();
if (!["desktop", "mobile"].includes(DEVICE)) {
  console.error("  Invalid --device. Use desktop or mobile.");
  process.exit(1);
}
const MOBILE = DEVICE === "mobile";
const CATEGORIES = flagValue("--categories", "performance,accessibility,best-practices,seo");
const MAX_SITES = Math.max(0, parseInt(flagValue("--maxSites", "0"), 10) || 0);

const SCORE_COLS = ["performance", "accessibility", "best-practices", "seo", "pwa"];
const SUMMARY_HEADERS = [
  "name",
  "website",
  "domain",
  "device",
  ...SCORE_COLS,
  "finalUrl",
  "fetchTime",
  "reportHtml",
  "analyzeStatus",
];

// ---- tiny CSV (shared shape with scrape.js / enrich.js) ----------------------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let field = "";
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const normalizeUrl = (u) => {
  u = (u || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
};
const siteKey = (website) => hostOf(website) || (website || "").trim().toLowerCase();
const safeName = (s) => s.replace(/[^a-z0-9-]+/gi, "_").slice(0, 80) || "site";

// ---- Lighthouse runner -------------------------------------------------------
// Prefer a project-local Lighthouse install; fall back to a global command on PATH.
function lighthouseCommand() {
  const local = path.join(__dirname, "node_modules", ".bin", process.platform === "win32" ? "lighthouse.cmd" : "lighthouse");
  return fs.existsSync(local) ? local : process.platform === "win32" ? "lighthouse.cmd" : "lighthouse";
}
const LH_CMD = lighthouseCommand();

function runLighthouse(url, outBase) {
  return new Promise((resolve) => {
    const chromeFlags = ["--headless=new", "--no-sandbox", "--disable-gpu"].join(" ");
    const args = [
      url,
      "--quiet",
      `--chrome-flags=${chromeFlags}`,
      "--output=json",
      "--output=html",
      `--output-path=${outBase}`,
      `--only-categories=${CATEGORIES}`,
      "--max-wait-for-load=45000",
      ...(MOBILE ? [] : ["--preset=desktop"]),
    ];
    let stderr = "";
    let done = false;
    const child = spawn(LH_CMD, args, { shell: true, windowsHide: true });
    const killer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill();
        resolve({ ok: false, error: "timeout" });
      }
    }, TIMEOUT);
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: (stderr.trim().split("\n").pop() || `exit ${code}`).slice(0, 120) });
    });
  });
}

// Lighthouse writes <base>.report.json / <base>.report.html for an extension-less path.
function readScores(outBase, summaryFile) {
  const jsonPath = `${outBase}.report.json`;
  const htmlPath = `${outBase}.report.html`;
  const lhr = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const cats = lhr.categories || {};
  const scores = {};
  for (const col of SCORE_COLS) {
    const c = cats[col];
    scores[col] = c && typeof c.score === "number" ? Math.round(c.score * 100) : "";
  }
  return {
    scores,
    finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl || "",
    fetchTime: lhr.fetchTime || "",
    reportHtml: fs.existsSync(htmlPath)
      ? path.relative(path.dirname(summaryFile), htmlPath).replace(/\\/g, "/")
      : "",
  };
}

// ---- state (resume) ----------------------------------------------------------
function loadState(stateFile) {
  const map = new Map();
  if (FORCE || !fs.existsSync(stateFile)) return map;
  for (const line of fs.readFileSync(stateFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.key) map.set(rec.key, rec.result);
    } catch {}
  }
  return map;
}

// ---- main --------------------------------------------------------------------
(async () => {
  // Resolve input: explicit path, else most recent CSV in ./output (prefer enriched).
  let input = positionals[0];
  if (!input) {
    const dir = path.join(__dirname, "output");
    const csvs = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".csv"))
          .map((f) => path.join(dir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    input = csvs.find((f) => f.includes("-enriched")) || csvs[0];
    if (!input) {
      console.error("  No CSV found in ./output. Pass a file: node analyze.js output/leads.csv");
      process.exit(1);
    }
  }
  input = path.resolve(input);
  if (!fs.existsSync(input)) {
    console.error(`  File not found: ${input}`);
    process.exit(1);
  }

  // Reports live next to the CSV by default, in a sibling "lighthouse" folder.
  const outDir = path.resolve(flagValue("--outDir", path.join(path.dirname(input), "lighthouse", DEVICE)));
  fs.mkdirSync(outDir, { recursive: true });
  const summaryFile = path.resolve(flagValue("--summary", input.replace(/\.csv$/i, `-lighthouse-${DEVICE}.csv`)));
  const stateFile = path.join(outDir, `.analyze-${DEVICE}-state.jsonl`);
  const state = loadState(stateFile);

  const parsed = parseCsv(fs.readFileSync(input, "utf8"));
  if (parsed.length < 2) {
    console.error("  Input CSV has no data rows.");
    process.exit(1);
  }
  const headers = parsed[0];
  const webCol = headers.includes("website") ? "website" : headers.find((h) => /web|url|site/i.test(h)) || "website";
  const nameCol = headers.includes("name") ? "name" : headers[0];
  const rows = parsed.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });

  // Unique sites to audit, in first-seen order.
  const queue = [];
  const seen = new Set();
  for (const row of rows) {
    const w = normalizeUrl(row[webCol]);
    if (!w) continue;
    const key = siteKey(w);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (state.has(key)) continue;
    queue.push({ key, website: w, name: row[nameCol] || "" });
  }
  if (MAX_SITES && queue.length > MAX_SITES) queue.length = MAX_SITES;
  const totalQueue = queue.length;

  console.log(`\n  Input  : ${input}`);
  console.log(`  Reports: ${outDir}`);
  console.log(`  Summary: ${summaryFile}`);
  console.log(`  Resume : ${state.size ? state.size + " sites already done (use --force to redo)" : "fresh run"}`);
  console.log(`  Mode   : ${DEVICE}, concurrency ${CONCURRENCY}, ${seen.size} unique sites (${queue.length} to audit)\n`);

  function flushSummary() {
    const lines = [String.fromCharCode(0xfeff) + SUMMARY_HEADERS.join(",") + "\r\n"];
    const emitted = new Set();
    for (const row of rows) {
      const w = normalizeUrl(row[webCol]);
      const key = w ? siteKey(w) : "";
      if (!w) continue;
      if (emitted.has(key)) continue; // one row per unique site
      emitted.add(key);
      const res = state.get(key) || {};
      const out = {
        name: row[nameCol] || res.name || "",
        website: row[webCol] || w,
        domain: key,
        device: res.device || DEVICE,
        ...SCORE_COLS.reduce((o, c) => ((o[c] = res.scores ? res.scores[c] : ""), o), {}),
        finalUrl: res.finalUrl || "",
        fetchTime: res.fetchTime || "",
        reportHtml: res.reportHtml || "",
        analyzeStatus: res.analyzeStatus || "pending",
      };
      lines.push(SUMMARY_HEADERS.map((h) => csvEsc(out[h])).join(",") + "\r\n");
    }
    fs.writeFileSync(summaryFile, lines.join(""), "utf8");
  }

  let processed = 0;
  let ok = 0;

  async function worker() {
    while (true) {
      const job = queue.shift();
      if (!job) return;
      const outBase = path.join(outDir, safeName(job.key));
      let result = { name: job.name, website: job.website, device: DEVICE };
      try {
        const run = await runLighthouse(job.website, outBase);
        if (run.ok) {
          const data = readScores(outBase, summaryFile);
          result = { ...result, ...data, analyzeStatus: "ok" };
        } else {
          result.analyzeStatus = "error: " + run.error;
        }
      } catch (err) {
        result.analyzeStatus = "error: " + (err.message || "failed").slice(0, 100);
      }
      state.set(job.key, result);
      fs.appendFileSync(stateFile, JSON.stringify({ key: job.key, result }) + "\n", "utf8");
      processed++;
      if (result.analyzeStatus === "ok") ok++;
      const perf = result.scores ? `perf ${result.scores.performance}` : result.analyzeStatus;
      console.log(`  [${processed}/${totalQueue}] ${job.key}  ->  ${perf}`);
      flushSummary();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  flushSummary();

  console.log(`\n  Done. ${processed} sites audited this run, ${ok} succeeded.`);
  console.log(`  Summary CSV : ${summaryFile}`);
  console.log(`  HTML reports: ${outDir}\\<domain>.report.html\n`);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
