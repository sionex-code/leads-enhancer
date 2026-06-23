const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const db = require("./db.cjs");

// Two roots so the runner works both as the web app (repo) and inside the
// Electron desktop build:
//   ROOT      — where the runner scripts + node_modules live (read-only in the
//               packaged app: the standalone bundle). Used to locate web-runner.js
//               / scrape.js etc. and as the child process cwd.
//   DATA_ROOT — writable location for projects/output/leads.db (per-user in the
//               desktop app via GMAPS_DATA_DIR).
// Both default to process.cwd() so the normal web/CLI usage is unchanged.
const ROOT = process.env.GMAPS_APP_ROOT || process.cwd();
const DATA_ROOT = process.env.GMAPS_DATA_DIR || process.cwd();
const PROJECT_ROOT = path.join(DATA_ROOT, "output", "projects");

function slugify(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 70) || "project"
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// A project already exists for this user when its dir holds a project.json.
function projectExists(name, userId) {
  try {
    return fs.existsSync(metaPath(safeProjectDir(slugify(name), userId)));
  } catch {
    return false;
  }
}

// Random 5-char id (A–Z + digits) used to de-collide duplicate project names.
const PROJECT_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomProjectId(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += PROJECT_ID_ALPHABET[Math.floor(Math.random() * PROJECT_ID_ALPHABET.length)];
  return s;
}

// Give a brand-new project a unique name/slug for this user: if the requested
// name's slug already exists, append a random 5-char id until it's unique so a
// duplicate run becomes its own project instead of merging into the old one.
function uniqueProjectName(name, userId) {
  const base = String(name || "").trim() || "project";
  if (!projectExists(base, userId)) return { name: base, slug: slugify(base) };
  for (let i = 0; i < 25; i++) {
    const candidate = `${base} ${randomProjectId(5)}`;
    if (!projectExists(candidate, userId)) return { name: candidate, slug: slugify(candidate) };
  }
  const candidate = `${base} ${randomProjectId(5)}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  return { name: candidate, slug: slugify(candidate) };
}

// Per-tenant project root. On the web server, each request passes the signed-in
// userId so users never share project dirs (two users can both have a project
// named "plumbers-miami" without colliding). Inside the runner child, userId is
// omitted — its GMAPS_DATA_DIR is already set to the tenant dir by spawnRunner,
// so PROJECT_ROOT is per-tenant and projectRootFor() returns it directly.
function projectRootFor(userId) {
  if (!userId) return PROJECT_ROOT;
  return path.join(DATA_ROOT, "tenants", String(userId), "output", "projects");
}

// The GMAPS_DATA_DIR a runner child should use for a given user (its output/
// tree, project files and logs all live under here). Mirrors projectRootFor.
function tenantDataDir(userId) {
  return path.join(DATA_ROOT, "tenants", String(userId));
}

function projectDir(slugOrName, userId) {
  return path.join(projectRootFor(userId), slugify(slugOrName));
}

function safeProjectDir(slugOrName, userId) {
  const root = path.resolve(projectRootFor(userId));
  const dir = path.resolve(projectDir(slugOrName, userId));
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new Error("Invalid project path");
  return dir;
}

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function metaPath(dir) {
  return path.join(dir, "project.json");
}

function statePath(dir) {
  return path.join(dir, "web-state.json");
}

function readMeta(dir) {
  return readJson(metaPath(dir), {});
}

function readState(dir) {
  return readJson(statePath(dir), {
    running: false,
    activePid: null,
    stages: {},
    message: "",
  });
}

function writeMeta(dir, patch) {
  const now = new Date().toISOString();
  const current = readMeta(dir);
  const meta = {
    ...current,
    ...patch,
    slug: patch.slug || current.slug || slugify(patch.name || current.name || path.basename(dir)),
    createdAt: current.createdAt || patch.createdAt || now,
    updatedAt: now,
  };
  writeJson(metaPath(dir), meta);
  return meta;
}

function writeState(dir, patch) {
  const current = readState(dir);
  const state = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(statePath(dir), state);
  return state;
}

function setStage(dir, stage, patch) {
  const state = readState(dir);
  const stages = {
    ...(state.stages || {}),
    [stage]: {
      ...(state.stages ? state.stages[stage] : {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
  return writeState(dir, { stages });
}

function parseCsv(text) {
  if (!text) return [];
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

function toObjects(parsed) {
  if (!parsed.length) return [];
  const headers = parsed[0];
  return parsed.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = r[i] || "";
    });
    return o;
  });
}

function readCsvObjects(file) {
  try {
    if (!file || !fs.existsSync(file)) return [];
    return toObjects(parseCsv(fs.readFileSync(file, "utf8")));
  } catch {
    return [];
  }
}

function filesIn(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => path.join(dir, f))
    .filter((f) => {
      try {
        return fs.statSync(f).isFile() && predicate(f);
      } catch {
        return false;
      }
    })
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

function mtimeOf(file) {
  try {
    return file ? fs.statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function latestInputCsv(dir) {
  const raw = latestRawCsv(dir);
  const enriched = latestEnrichedCsv(dir);
  if (!enriched) return raw;
  if (!raw) return enriched;
  // Prefer the enriched CSV only when it's at least as new as the latest raw
  // scrape. A stale enriched file (from an earlier run, or a differently-named
  // query) must not shadow a fresher raw CSV — otherwise the UI shows "No leads
  // loaded" while a full raw scrape sits right next to it.
  return mtimeOf(enriched) >= mtimeOf(raw) ? enriched : raw;
}

function summaryPath(input, device) {
  return input ? input.replace(/\.csv$/i, `-lighthouse-${device}.csv`) : "";
}

function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function countRows(file) {
  return readCsvObjects(file).length;
}

function tail(file, maxLines = 80) {
  try {
    if (!fs.existsSync(file)) return "";
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    return lines.slice(-maxLines).join("\n").trim();
  } catch {
    return "";
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid) {
  if (!pid) return;
  pid = Number(pid);
  if (!pid || pid === process.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }, 2500).unref();
    }
  } catch {}
}

function killProcessesUsingPath(targetPath) {
  const needle = path.resolve(targetPath);
  if (!needle) return 0;
  let killed = 0;
  if (process.platform === "win32") {
    const script = `
      $needle = ${JSON.stringify(needle)};
      Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($needle)
      } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue;
        Write-Output $_.ProcessId
      }
    `;
    try {
      const out = execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
      killed = out.trim() ? out.trim().split(/\r?\n/).length : 0;
    } catch {}
  } else {
    try {
      const out = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
      for (const line of out.split(/\n/)) {
        if (!line.includes(needle)) continue;
        const pid = Number(line.trim().split(/\s+/, 1)[0]);
        if (!pid || pid === process.pid) continue;
        try {
          process.kill(pid, "SIGTERM");
          killed++;
        } catch {}
      }
    } catch {}
  }
  return killed;
}

function cleanupBrowser(dir) {
  const profileDir = path.join(dir, "browser-profile");
  const killed = killProcessesUsingPath(profileDir);
  if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
  return { killed, profileDir };
}

// Stop EVERYTHING: kill each running project's whole process tree (which cascades
// to the scrape/enrich/analyze children and the Lighthouse + headless Chrome they
// spawn), mark every project idle, then sweep any orphaned processes still
// referencing the projects tree (e.g. a Lighthouse run whose parent already died).
function stopAll(userId) {
  const root = projectRootFor(userId);
  ensureDir(root);
  let projects = 0;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const state = readState(dir);
    if (state.activePid && processAlive(state.activePid)) {
      killTree(state.activePid);
      projects++;
    }
    if (state.activePid || state.running) {
      const stages = { ...(state.stages || {}) };
      for (const [k, s] of Object.entries(stages)) {
        if (s && s.status === "running") stages[k] = { ...s, status: "stopped" };
      }
      writeState(dir, {
        running: false,
        activePid: null,
        message: "Stopped (stop all)",
        stoppedAt: new Date().toISOString(),
        stages,
      });
    }
  }
  // Backstop for orphans whose runner is already gone (taskkill /T on the runner
  // normally gets these, but a detached/re-parented Lighthouse can survive).
  const swept = killProcessesUsingPath(root);
  return { projects, swept };
}

function projectLogFiles(dir) {
  return [
    path.join(dir, "web-runner.log"),
    path.join(dir, "scrape.log"),
    path.join(dir, "enrich.log"),
    path.join(dir, "audit-desktop.log"),
    path.join(dir, "audit-mobile.log"),
    path.join(dir, "report.log"),
  ];
}

function siteKeyForProgress(lead) {
  const website = String(lead?.website || "").trim();
  return hostOf(website) || website.toLowerCase();
}

function readEnrichProgress(input, stage = {}) {
  if (!input) {
    return {
      totalSites: 0,
      processedSites: 0,
      withEmail: 0,
      runTotal: 0,
      runDone: 0,
      remaining: 0,
      percent: 0,
      etaSeconds: null,
      elapsedSeconds: 0,
      status: stage?.status || "idle",
    };
  }

  const siteKeys = new Set(readCsvObjects(input).map(siteKeyForProgress).filter(Boolean));
  const totalSites = siteKeys.size;
  const stateFile = input.replace(/\.csv$/i, ".enrich-state.jsonl");
  const startMs = Date.parse(stage?.startedAt || "") || 0;
  const processedKeys = new Set();
  const withEmailKeys = new Set();
  const previousEmailKeys = new Set();
  const runKeys = new Set();

  if (fs.existsSync(stateFile)) {
    for (const line of fs.readFileSync(stateFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        const key = String(rec.key || siteKeyForProgress({ website: rec.website }) || "").trim();
        if (!key || !siteKeys.has(key)) continue;
        processedKeys.add(key);
        if (rec.result?.email) withEmailKeys.add(key);
        const tsMs = Date.parse(rec.ts || rec.timestamp || "") || 0;
        if (startMs && tsMs >= startMs) {
          runKeys.add(key);
        } else if (rec.result?.email) {
          previousEmailKeys.add(key);
        }
      } catch {}
    }
  }

  const runTotal = startMs ? Math.max(0, totalSites - previousEmailKeys.size) : totalSites;
  const runDone = startMs ? Math.min(runTotal, runKeys.size) : Math.min(totalSites, processedKeys.size);
  const remaining = Math.max(0, runTotal - runDone);
  const elapsedSeconds = startMs ? Math.max(1, Math.round((Date.now() - startMs) / 1000)) : 0;
  const rate = elapsedSeconds > 0 && runDone > 0 ? runDone / elapsedSeconds : 0;
  const etaSeconds = stage?.status === "running" && rate > 0 ? Math.round(remaining / rate) : null;
  const percent = runTotal ? Math.min(100, Math.round((runDone / runTotal) * 100)) : totalSites ? 100 : 0;

  return {
    totalSites,
    processedSites: Math.min(totalSites, processedKeys.size),
    withEmail: withEmailKeys.size,
    runTotal,
    runDone,
    remaining,
    percent,
    etaSeconds,
    elapsedSeconds,
    status: stage?.status || "idle",
  };
}

function loadStatus(slugOrName, userId) {
  const dir = safeProjectDir(slugOrName, userId);
  const meta = readMeta(dir);
  const state = readState(dir);
  const raw = latestRawCsv(dir);
  const enriched = latestEnrichedCsv(dir);
  const input = latestInputCsv(dir);
  const desktopFile = summaryPath(input, "desktop");
  const mobileFile = summaryPath(input, "mobile");
  const desktopRows = readCsvObjects(desktopFile);
  const mobileRows = readCsvObjects(mobileFile);
  const desktopByDomain = new Map(desktopRows.map((r) => [r.domain || hostOf(r.website), r]));
  const mobileByDomain = new Map(mobileRows.map((r) => [r.domain || hostOf(r.website), r]));
  const leadRows = readCsvObjects(input);
  const leads = leadRows.map((lead) => {
    const domain = hostOf(lead.website);
    return {
      ...lead,
      domain,
      desktop: desktopByDomain.get(domain) || null,
      mobile: mobileByDomain.get(domain) || null,
    };
  });
  const logs = projectLogFiles(dir)
    .map((file) => {
      const body = tail(file, 70);
      return body ? `== ${path.basename(file)} ==\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const activeAlive = processAlive(state.activePid);
  return {
    slug: slugify(meta.name || slugOrName),
    name: meta.name || slugOrName,
    query: meta.query || "",
    max: meta.max || "",
    watchlist: !!meta.watchlist,
    cityName: meta.cityName || "",
    countryName: meta.countryName || "",
    isUnknownKeyword: meta.isUnknownKeyword === "1",
    dir,
    state: { ...state, activeAlive },
    files: {
      raw,
      enriched,
      input,
      desktop: fs.existsSync(desktopFile) ? desktopFile : "",
      mobile: fs.existsSync(mobileFile) ? mobileFile : "",
      report: fs.existsSync(path.join(dir, `${slugify(meta.name || slugOrName)}-report.html`))
        ? path.join(dir, `${slugify(meta.name || slugOrName)}-report.html`)
        : "",
    },
    counts: {
      raw: countRows(raw),
      enriched: countRows(enriched),
      websites: leadRows.filter((r) => r.website).length,
      desktopAudits: desktopRows.filter((r) => r.analyzeStatus === "ok").length,
      mobileAudits: mobileRows.filter((r) => r.analyzeStatus === "ok").length,
    },
    enrichProgress: readEnrichProgress(raw || input, state.stages?.enrich),
    leads,
    logs,
  };
}

// Cache for the per-project sidebar summary, keyed by dir. The dashboard polls
// EVERY project every ~1.5s; recomputing row counts means re-parsing each CSV,
// so we only redo it when a source file's mtime actually changed. Idle/finished
// projects then cost a few stat() calls instead of a full CSV parse.
const summaryCache = new Map();

// Lightweight project summary for the sidebar list. Unlike loadStatus() this
// does NOT build the full leads array, domain maps, or tail every log file — the
// sidebar only needs counts + the running flag, and doing the heavy work for
// every project on every poll is what made the UI glitch under load.
function projectSummary(dir) {
  const meta = readMeta(dir);
  const state = readState(dir);
  const raw = latestRawCsv(dir);
  const input = latestInputCsv(dir);
  const desktopFile = summaryPath(input, "desktop");
  const mobileFile = summaryPath(input, "mobile");

  const sig = [raw, desktopFile, mobileFile].map((f) => `${f || ""}@${mtimeOf(f)}`).join("|");
  const cached = summaryCache.get(dir);
  let counts = cached?.counts;
  if (!cached || cached.sig !== sig) {
    counts = {
      raw: countRows(raw),
      desktopAudits: readCsvObjects(desktopFile).filter((r) => r.analyzeStatus === "ok").length,
      mobileAudits: readCsvObjects(mobileFile).filter((r) => r.analyzeStatus === "ok").length,
    };
    summaryCache.set(dir, { sig, counts });
  }

  return {
    slug: path.basename(dir),
    name: meta.name || path.basename(dir),
    query: meta.query || "",
    watchlist: !!meta.watchlist,
    cityName: meta.cityName || "",
    countryName: meta.countryName || "",
    isUnknownKeyword: meta.isUnknownKeyword === "1",
    counts,
    running: processAlive(state.activePid),
    updatedAt: meta.updatedAt || state.updatedAt || "",
  };
}

function listProjects(userId) {
  const root = projectRootFor(userId);
  ensureDir(root);
  return fs
    .readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .map((dir) => projectSummary(dir))
    .sort((a, b) => Number(!!b.watchlist) - Number(!!a.watchlist) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function spawnRunner(payload) {
  const userId = payload.userId || null;
  const dir = safeProjectDir(payload.name, userId);
  ensureDir(dir);
  const meta = writeMeta(dir, {
    name: payload.name,
    slug: slugify(payload.name),
    query: payload.query || readMeta(dir).query || "",
    max: payload.max || readMeta(dir).max || "",
  });
  const args = [
    path.join(ROOT, "web-runner.js"),
    "--project",
    meta.name,
    "--stages",
    (payload.stages || []).join(","),
    "--query",
    meta.query || "",
    "--max",
    String(meta.max || ""),
    "--device",
    payload.device || "all",
    "--enrichConcurrency",
    String(payload.enrichConcurrency || 16),
    "--enrichEngine",
    payload.enrichEngine === "crawlee" ? "crawlee" : "patchright",
    "--auditConcurrency",
    String(payload.auditConcurrency || 2),
  ];
  if (payload.headless) args.push("--headless");
  if (payload.blockCanvas) args.push("--blockCanvas");
  if (payload.blockImages === false) args.push("--allowImages");
  // Scrape capture mode: fast network RPC reading (default) vs legacy DOM clicking.
  args.push(payload.network === false ? "--dom" : "--network");
  // Capture the runner's early stdout/stderr (before it sets up its own per-stage
  // logs) so boot-time crashes are diagnosable instead of vanishing.
  const bootLogPath = path.join(dir, "runner-boot.log");
  const bootLog = fs.openSync(bootLogPath, "a");
  const runnerExe = process.env.GMAPS_RUNNER_NODE || process.execPath;
  fs.appendFileSync(bootLogPath, `[spawn] exe=${runnerExe} runAsNode=${process.env.ELECTRON_RUN_AS_NODE || "(set in child)"} cwd=${ROOT}\n`);
  const child = spawn(runnerExe, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", bootLog, bootLog],
    windowsHide: true,
    // In the Electron build runnerExe is the app exe; ELECTRON_RUN_AS_NODE makes
    // it run web-runner.js as plain Node. Harmless under the web/CLI server (real
    // Node ignores the flag). GMAPS_USER_ID tells the runner which tenant owns the
    // leads it upserts; GMAPS_DATA_DIR points its output/ tree at that tenant's
    // isolated folder so project files never collide across users.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ...(userId
        ? { GMAPS_USER_ID: String(userId), GMAPS_DATA_DIR: tenantDataDir(userId) }
        : {}),
    },
  });
  child.unref();
  writeState(dir, {
    running: true,
    activePid: child.pid,
    message: "Started",
    requestedStages: payload.stages || [],
  });
  return { pid: child.pid, slug: meta.slug, name: meta.name };
}

function deleteProject(slugOrName, userId) {
  const dir = safeProjectDir(slugOrName, userId);
  const state = readState(dir);
  if (state.activePid) killTree(state.activePid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function setProjectWatchlist(slugOrName, watchlist, userId) {
  const dir = safeProjectDir(slugOrName, userId);
  const meta = writeMeta(dir, { watchlist: !!watchlist });
  return { slug: meta.slug, name: meta.name || slugOrName, watchlist: !!meta.watchlist };
}

// The user who owns the current run. In the SaaS the queue sets GMAPS_USER_ID in
// the runner's environment; web-context callers pass it explicitly. Returns null
// for legacy CLI usage with no owner configured.
function ownerId() {
  return process.env.GMAPS_USER_ID || null;
}

// Merge this project's lead CSV with its Lighthouse summaries and upsert every
// row into the global deduped leads DB. Safe to call repeatedly (after each
// stage); only non-empty fields overwrite, so partial runs accumulate.
async function syncProjectToDb(slugOrName) {
  const uid = ownerId();
  if (!uid) {
    console.warn("[store] syncProjectToDb skipped: no GMAPS_USER_ID owner set");
    return { inserted: 0, updated: 0 };
  }
  const dir = safeProjectDir(slugOrName);
  const meta = readMeta(dir);
  const raw = latestRawCsv(dir);
  const enriched = latestEnrichedCsv(dir);
  const input = enriched || raw;
  if (!input) return { inserted: 0, updated: 0 };

  const desktopRows = readCsvObjects(summaryPath(latestInputCsv(dir), "desktop"));
  const mobileRows = readCsvObjects(summaryPath(latestInputCsv(dir), "mobile"));
  const byDomain = (rows) => new Map(rows.map((r) => [r.domain || hostOf(r.website), r]));
  const desktopByDomain = byDomain(desktopRows);
  const mobileByDomain = byDomain(mobileRows);

  const projectName = meta.name || slugOrName;
  const query = meta.query || "";
  const leads = readCsvObjects(input).map((lead) => {
    const domain = hostOf(lead.website);
    const d = desktopByDomain.get(domain) || {};
    const m = mobileByDomain.get(domain) || {};
    return {
      ...lead,
      project: projectName,
      query,
      desktop_performance: d.performance,
      desktop_seo: d.seo,
      desktop_accessibility: d.accessibility,
      desktop_best_practices: d["best-practices"],
      mobile_performance: m.performance,
      mobile_seo: m.seo,
      mobile_accessibility: m.accessibility,
      mobile_best_practices: m["best-practices"],
    };
  });
  return db.upsertLeads(uid, leads);
}

module.exports = {
  ownerId,
  ROOT,
  PROJECT_ROOT,
  slugify,
  ensureDir,
  projectExists,
  uniqueProjectName,
  safeProjectDir,
  projectDir,
  readMeta,
  writeMeta,
  readState,
  writeState,
  setStage,
  latestRawCsv,
  latestEnrichedCsv,
  latestInputCsv,
  summaryPath,
  hostOf,
  readCsvObjects,
  loadStatus,
  listProjects,
  processAlive,
  killTree,
  cleanupBrowser,
  stopAll,
  spawnRunner,
  deleteProject,
  setProjectWatchlist,
  syncProjectToDb,
  db,
};
