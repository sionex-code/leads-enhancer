#!/usr/bin/env node
// LeadsFunda capability worker — run heavy modules (scraper / enrich / whatsapp /
// audit) on a separate VPS to balance load off the main app. It exposes only the
// modules you enable and guards every request with WORKER_SECRET. The leads DB is
// shared (same DATABASE_URL), so scraped/enriched rows land centrally.
//
//   node worker.cjs --modules=scraper           # this box only runs the scraper
//   WORKER_MODULES=enrich,whatsapp node worker.cjs
//
// Then on the main app set e.g. SCRAPER_WORKER_URL=http://<this-vps>:8787 and the
// matching WORKER_SECRET. See modules/README.md.
const path = require("path");
process.env.GMAPS_APP_ROOT = process.env.GMAPS_APP_ROOT || __dirname;
require("./scripts/load-env.cjs"); // fill process.env from .env / .env.local

const http = require("http");
const fs = require("fs");
const os = require("os");

const ROOT = __dirname;
const ALL = ["scraper", "enrich", "whatsapp", "audit"];

// ---- config -------------------------------------------------------------------
function parseModules() {
  const fromFlag = (process.argv.slice(2).find((a) => a.startsWith("--modules=")) || "").split("=")[1];
  const raw = (fromFlag || process.env.WORKER_MODULES || ALL.join(",")).toLowerCase();
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const enabled = wanted.includes("all") ? ALL.slice() : wanted.filter((m) => ALL.includes(m));
  return enabled.length ? enabled : ALL.slice();
}

const ENABLED = parseModules();
const SECRET = (process.env.WORKER_SECRET || "").trim();
const PORT = Number(process.env.WORKER_PORT || 8787);

// Local backends only — the worker IS the local end, so never go through the
// dispatching index (that could loop back out over HTTP).
const backends = {
  scraper: () => require("./modules/scraper/local.cjs"),
  enrich: () => require("./modules/enrich/local.cjs"),
  whatsapp: () => require("./modules/whatsapp/local.cjs"),
  audit: () => require("./modules/audit/local.cjs"),
};

// ---- helpers ------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const LIMIT = Number(process.env.WORKER_BODY_LIMIT || 200 * 1024 * 1024);
    req.on("data", (c) => {
      size += c.length;
      if (size > LIMIT) {
        reject(new Error("request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function csvSig(dir, f) {
  const st = fs.statSync(path.join(dir, f));
  return `${st.mtimeMs}:${st.size}`;
}
function snapshotCsvs(dir) {
  const map = {};
  for (const f of fs.readdirSync(dir)) if (f.toLowerCase().endsWith(".csv")) map[f] = csvSig(dir, f);
  return map;
}
// CSVs that are new or changed vs the pre-run snapshot — the stage's outputs.
function changedCsvs(dir, before) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith(".csv")) continue;
    if (before[f] !== csvSig(dir, f)) out.push(f);
  }
  return out;
}
const fileB64 = (p) => fs.readFileSync(p).toString("base64");

// Generic CSV batch: write input(s) to a temp dir, run the module's file-level
// core, return any new/changed CSVs. Used by enrich/whatsapp/audit /…/batch.
async function handleBatch(moduleName, body) {
  const mod = backends[moduleName]();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lf-${moduleName}-`));
  try {
    let inputPath = null;
    for (const inp of body.inputs || []) {
      const p = path.join(tmp, path.basename(inp.name));
      fs.writeFileSync(p, Buffer.from(inp.data, "base64"));
      if (!inputPath) inputPath = p;
    }
    if (!inputPath) throw new Error("no input file provided");
    const before = snapshotCsvs(tmp);
    await mod.runFile({ ROOT, inputPath, params: body.params || {} });
    const outputs = changedCsvs(tmp, before).map((name) => ({ name, data: fileB64(path.join(tmp, name)) }));
    return { ok: true, message: `${moduleName} processed ${path.basename(inputPath)}`, outputs };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function handleScraperRun(body) {
  const scraper = backends.scraper();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lf-scraper-"));
  try {
    const csvPath = await scraper.runScrapeToDir({
      ROOT,
      query: body.query,
      max: body.max,
      outDir: tmp,
      project: body.project,
      userId: body.userId,
      mode: body.mode,
      blockCanvas: !!body.blockCanvas,
      allowImages: !!body.allowImages,
      headless: true,
      log: (m) => console.log("[scraper]", m),
    });
    let csv = null;
    let rows = null;
    if (csvPath && fs.existsSync(csvPath)) {
      const buf = fs.readFileSync(csvPath);
      csv = { name: path.basename(csvPath), data: buf.toString("base64") };
      rows = Math.max(0, buf.toString("utf8").split(/\r?\n/).filter(Boolean).length - 1);
    }
    return { ok: true, message: "scrape complete", csv, rows };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// route -> handler. Only routes whose module is enabled get mounted.
const ROUTES = {
  "/scraper/run": (b) => handleScraperRun(b),
  "/enrich/site": async (b) => ({ ok: true, result: await backends.enrich().enrichSite(b.website) }),
  "/enrich/batch": (b) => handleBatch("enrich", b),
  "/whatsapp/check": async (b) => ({ ok: true, result: await backends.whatsapp().checkNumber(b.number) }),
  "/whatsapp/batch": (b) => handleBatch("whatsapp", b),
  "/audit/url": async (b) => ({ ok: true, result: await backends.audit().audit(b.url, { mobile: !!b.mobile, timeout: b.timeout, headless: true }) }),
  "/audit/batch": (b) => handleBatch("audit", b),
};

// ---- server -------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  try {
    const route = req.url.split("?")[0];
    if (req.method === "GET" && route === "/health") return send(200, { ok: true, modules: ENABLED });
    if (req.method !== "POST" || !ROUTES[route]) return send(404, { error: "not found" });
    if (!SECRET || req.headers["x-worker-secret"] !== SECRET) return send(401, { error: "unauthorized" });
    const moduleName = route.split("/")[1];
    if (!ENABLED.includes(moduleName)) return send(404, { error: `module '${moduleName}' not enabled on this worker` });
    const body = await readBody(req);
    const result = await ROUTES[route](body);
    return send(200, result);
  } catch (err) {
    console.error("[worker] error:", err && err.stack || err);
    return send(500, { error: String((err && err.message) || err) });
  }
});

(async () => {
  if (!SECRET) {
    console.error("[worker] refusing to start: WORKER_SECRET is not set");
    process.exit(1);
  }
  // DB-writing modules (scraper) need the schema present. Idempotent + guarded.
  if (ENABLED.includes("scraper")) {
    try {
      const { ensureSchema } = require("./web/lib/migrate.cjs");
      await ensureSchema();
    } catch (err) {
      console.warn("[worker] schema migrate skipped:", (err && err.message) || err);
    }
  }
  server.listen(PORT, () => console.log(`[worker] listening on :${PORT} — modules: ${ENABLED.join(", ")}`));
})();
