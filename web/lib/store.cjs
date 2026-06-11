const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const db = require("./db.cjs");

const ROOT = process.cwd();
const PROJECT_ROOT = path.join(ROOT, "output", "projects");

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

function projectDir(slugOrName) {
  return path.join(PROJECT_ROOT, slugify(slugOrName));
}

function safeProjectDir(slugOrName) {
  const dir = path.resolve(projectDir(slugOrName));
  const root = path.resolve(PROJECT_ROOT) + path.sep;
  if (!dir.startsWith(root)) throw new Error("Invalid project path");
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
function stopAll() {
  ensureDir(PROJECT_ROOT);
  let projects = 0;
  for (const name of fs.readdirSync(PROJECT_ROOT)) {
    const dir = path.join(PROJECT_ROOT, name);
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
  const swept = killProcessesUsingPath(PROJECT_ROOT);
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

function loadStatus(slugOrName) {
  const dir = safeProjectDir(slugOrName);
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
    counts,
    running: processAlive(state.activePid),
    updatedAt: meta.updatedAt || state.updatedAt || "",
  };
}

function listProjects() {
  ensureDir(PROJECT_ROOT);
  return fs
    .readdirSync(PROJECT_ROOT)
    .map((name) => path.join(PROJECT_ROOT, name))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .map((dir) => projectSummary(dir))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function spawnRunner(payload) {
  const dir = safeProjectDir(payload.name);
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
    "--auditConcurrency",
    String(payload.auditConcurrency || 2),
  ];
  if (payload.headless) args.push("--headless");
  if (payload.blockCanvas) args.push("--blockCanvas");
  if (payload.blockImages === false) args.push("--allowImages");
  // Scrape capture mode: fast network RPC reading (default) vs legacy DOM clicking.
  args.push(payload.network === false ? "--dom" : "--network");
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
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

function deleteProject(slugOrName) {
  const dir = safeProjectDir(slugOrName);
  const state = readState(dir);
  if (state.activePid) killTree(state.activePid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// Pull the next Gmail account from the rotation and drop its cookies into the
// project folder so scrape.js can load them via --cookies. Returns the cookie
// file path (or "" when no accounts are configured — then scrape runs logged out).
function writeRotatedCookies(slugOrName) {
  const account = db.nextAccount();
  if (!account || !account.cookies || !account.cookies.length) return { file: "", account: null };
  const dir = safeProjectDir(slugOrName);
  ensureDir(dir);
  const file = path.join(dir, "account-cookies.json");
  writeJson(file, account.cookies);
  return { file, account: { id: account.id, name: account.name } };
}

// Merge this project's lead CSV with its Lighthouse summaries and upsert every
// row into the global deduped leads DB. Safe to call repeatedly (after each
// stage); only non-empty fields overwrite, so partial runs accumulate.
function syncProjectToDb(slugOrName) {
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
  return db.upsertLeads(leads);
}

module.exports = {
  ROOT,
  PROJECT_ROOT,
  slugify,
  ensureDir,
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
  writeRotatedCookies,
  syncProjectToDb,
  db,
};
