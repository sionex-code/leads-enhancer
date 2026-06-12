// Independent per-website report generator. For each website (max 5 per batch):
//   1. Inspect the live site (title, meta, socials, emails, tech stack hints)
//   2. Run Google Lighthouse (desktop + mobile) via the existing analyze.cjs CLI
//   3. Ask the reasoning model to write a human analysis + outreach angle
//   4. Render a standalone dark HTML report under output/agent/reports/
//
// Batches run as background jobs (Lighthouse takes ~1min/site/device) tracked in
// output/agent/report-jobs.json; the UI/agent polls getJob(id).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const llm = require("./llm.cjs");

const ROOT = process.cwd();
const AGENT_DIR = path.join(ROOT, "output", "agent");
const REPORTS_DIR = path.join(AGENT_DIR, "reports");
const JOBS_FILE = path.join(AGENT_DIR, "report-jobs.json");
const MAX_SITES = 5;

function ensureDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normUrl(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// ---- live site inspection -----------------------------------------------------
const SOCIAL_PATTERNS = {
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[^"'\s<>)]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[^"'\s<>)]+/i,
  linkedin: /https?:\/\/(?:[a-z]+\.)?linkedin\.com\/[^"'\s<>)]+/i,
  twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s<>)]+/i,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/[^"'\s<>)]+/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@?[^"'\s<>)]+/i,
  pinterest: /https?:\/\/(?:[a-z]+\.)?pinterest\.com\/[^"'\s<>)]+/i,
  whatsapp: /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"'\s<>)]+/i,
};

function pickMeta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i");
  return (html.match(re) || html.match(alt) || [])[1] || "";
}

function detectTech(html, headers) {
  const tech = [];
  const h = html.toLowerCase();
  if (h.includes("wp-content") || h.includes("wp-includes")) tech.push("WordPress");
  if (h.includes("cdn.shopify.com")) tech.push("Shopify");
  if (h.includes("wix.com") || h.includes("wixstatic")) tech.push("Wix");
  if (h.includes("squarespace")) tech.push("Squarespace");
  if (h.includes("__next") || h.includes("_next/static")) tech.push("Next.js");
  if (h.includes("react")) tech.push("React");
  if (h.includes("elementor")) tech.push("Elementor");
  if (h.includes("gtag(") || h.includes("googletagmanager")) tech.push("Google Analytics/Tag Manager");
  if (h.includes("fbq(") || h.includes("facebook pixel")) tech.push("Meta Pixel");
  const gen = pickMeta(html, "generator");
  if (gen && !tech.some((t) => gen.toLowerCase().includes(t.toLowerCase()))) tech.push(gen);
  const server = headers.get ? headers.get("server") : "";
  if (server) tech.push(`Server: ${server}`);
  return [...new Set(tech)];
}

async function inspectWebsite(website) {
  const url = normUrl(website);
  const out = { url, ok: false, status: 0, https: url.startsWith("https"), responseMs: 0, sizeKb: 0,
    title: "", description: "", ogImage: false, h1: "", socials: {}, emails: [], phones: [], tech: [], error: "" };
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
      });
    } finally {
      clearTimeout(timer);
    }
    out.status = res.status;
    out.ok = res.ok;
    out.https = (res.url || url).startsWith("https");
    const html = (await res.text()).slice(0, 600000);
    out.responseMs = Date.now() - started;
    out.sizeKb = Math.round(Buffer.byteLength(html) / 1024);
    out.title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim().slice(0, 200) || "";
    out.description = (pickMeta(html, "description") || pickMeta(html, "og:description")).slice(0, 300);
    out.ogImage = !!pickMeta(html, "og:image");
    out.h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 160) || "";
    for (const [key, re] of Object.entries(SOCIAL_PATTERNS)) {
      const m = html.match(re);
      if (m) out.socials[key] = m[0].replace(/["'<>)].*$/, "");
    }
    out.emails = [...new Set((html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(e) && !e.includes("example."))
      .slice(0, 5))];
    out.phones = [...new Set((html.match(/(?:tel:)\+?[\d\s().-]{7,20}/gi) || []).map((p) => p.replace(/^tel:/i, "").trim()).slice(0, 3))];
    out.tech = detectTech(html, res.headers);
  } catch (err) {
    out.error = err.name === "AbortError" ? "timeout (20s)" : String(err.message || err).slice(0, 200);
    out.responseMs = Date.now() - started;
  }
  return out;
}

// ---- Lighthouse (reuses analyze.cjs) -------------------------------------------
function parseCsvObjects(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") lines.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); lines.push(row); }
  if (!lines.length) return [];
  const headers = lines[0];
  return lines.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

function csvEsc(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

async function runLighthouseBatch(sites, device, workDir, log, jobId) {
  const csvFile = path.join(workDir, `sites-${device}.csv`);
  const outDir = path.join(workDir, `lh-${device}`);
  const summaryFile = path.join(workDir, `summary-${device}.csv`);
  fs.mkdirSync(outDir, { recursive: true });
  const lines = ["name,website\r\n"];
  for (const s of sites) lines.push(`${csvEsc(s.name)},${csvEsc(normUrl(s.website))}\r\n`);
  fs.writeFileSync(csvFile, lines.join(""), "utf8");

  log(`Lighthouse ${device}: auditing ${sites.length} site(s)…`);
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(ROOT, "analyze.js"), csvFile,
      "--device", device, "--concurrency", "2", "--timeout", "120000",
      "--outDir", outDir, "--summary", summaryFile, "--force",
    ], { cwd: ROOT, stdio: "ignore", windowsHide: true });
    // record the worker pid so cancelJob can kill the in-flight Lighthouse run
    if (jobId) patchJob(jobId, { activePid: child.pid });
    child.on("close", resolve);
    child.on("error", resolve);
  });
  if (jobId) patchJob(jobId, { activePid: null });

  const summary = parseCsvObjects(fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "");
  const byDomain = {};
  for (const row of summary) {
    const domain = row.domain || hostOf(row.website);
    const detail = readLighthouseDetail(outDir, domain);
    byDomain[domain] = { ...row, ...detail };
  }
  return byDomain;
}

// Pull the headline metrics out of the Lighthouse JSON so the report can show
// real numbers (LCP, CLS…) instead of just the 0-100 category scores.
function readLighthouseDetail(outDir, domain) {
  try {
    // analyze.cjs saves reports as safeName(domain): non [a-z0-9-] chars → "_"
    const safe = domain.replace(/[^a-z0-9-]+/gi, "_").slice(0, 80);
    const file = fs.readdirSync(outDir).find((f) => f.endsWith(".report.json") && f.toLowerCase().startsWith(safe.toLowerCase()));
    if (!file) return {};
    const lhr = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
    const a = lhr.audits || {};
    const metric = (id) => a[id]?.displayValue || "";
    const failing = Object.values(a)
      .filter((x) => x && x.score !== null && x.score < 0.5 && x.details && ["opportunity", "table"].includes(x.details.type))
      .slice(0, 8)
      .map((x) => x.title);
    return {
      metrics: {
        "First Contentful Paint": metric("first-contentful-paint"),
        "Largest Contentful Paint": metric("largest-contentful-paint"),
        "Total Blocking Time": metric("total-blocking-time"),
        "Cumulative Layout Shift": metric("cumulative-layout-shift"),
        "Speed Index": metric("speed-index"),
      },
      failingAudits: failing,
      lhHtml: file.replace(/\.report\.json$/, ".report.html"),
    };
  } catch {
    return {};
  }
}

// ---- AI analysis ----------------------------------------------------------------
async function aiAnalysis(site, inspection, lighthouse) {
  const facts = {
    business: { name: site.name || "", category: site.category || "", phone: site.phone || "", address: site.address || "",
      rating: site.rating || "", email: site.email || "", whatsapp: site.whatsapp_status || site.whatsappExists || "" },
    website: {
      url: inspection.url, reachable: inspection.ok, https: inspection.https, status: inspection.status,
      responseMs: inspection.responseMs, title: inspection.title, description: inspection.description,
      h1: inspection.h1, hasOgImage: inspection.ogImage, tech: inspection.tech, error: inspection.error,
    },
    socialsOnSite: inspection.socials,
    socialsFromMaps: ["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok"].reduce((acc, k) => {
      if (site[k]) acc[k] = site[k];
      return acc;
    }, {}),
    emailsFound: inspection.emails,
    lighthouse: {
      desktop: lighthouse.desktop ? { performance: lighthouse.desktop.performance, seo: lighthouse.desktop.seo,
        accessibility: lighthouse.desktop.accessibility, bestPractices: lighthouse.desktop["best-practices"],
        metrics: lighthouse.desktop.metrics, topIssues: lighthouse.desktop.failingAudits } : null,
      mobile: lighthouse.mobile ? { performance: lighthouse.mobile.performance, seo: lighthouse.mobile.seo,
        accessibility: lighthouse.mobile.accessibility, bestPractices: lighthouse.mobile["best-practices"],
        metrics: lighthouse.mobile.metrics, topIssues: lighthouse.mobile.failingAudits } : null,
    },
  };
  try {
    return await llm.chat(
      [
        { role: "system", content: "You are a senior web/marketing auditor writing a client-ready website report. Be specific, factual, and concise. Use ONLY the data provided — never invent scores or facts. Output markdown with exactly these sections: ## Executive Summary (3-4 sentences), ## Website Quality (performance + technical findings), ## SEO & Visibility, ## Social Media Presence (which channels exist, which are missing), ## Top Recommendations (numbered, max 6, most impactful first), ## Outreach Angle (2-3 sentences: how a web agency could pitch this business)." },
        { role: "user", content: "Audit data:\n```json\n" + JSON.stringify(facts) + "\n```" },
      ],
      { model: "reasoning", maxTokens: 1800, temperature: 0.3 }
    );
  } catch (err) {
    return `*AI analysis unavailable: ${String(err.message || err).slice(0, 150)}*`;
  }
}

// Tiny markdown → HTML (headings, bold, lists, paragraphs) for the report body.
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc(String(md)).split(/\r?\n/);
  let html = "", inList = false;
  const inline = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
  for (const line of lines) {
    const t = line.trim();
    const li = t.match(/^(?:[-*]|\d+\.)\s+(.*)/);
    if (li) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (t.startsWith("### ")) html += `<h4>${inline(t.slice(4))}</h4>`;
    else if (t.startsWith("## ")) html += `<h3>${inline(t.slice(3))}</h3>`;
    else if (t.startsWith("# ")) html += `<h3>${inline(t.slice(2))}</h3>`;
    else if (t) html += `<p>${inline(t)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// ---- HTML report -----------------------------------------------------------------
function scoreColor(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "#3d4663";
  if (n >= 90) return "#22c55e";
  if (n >= 50) return "#f59e0b";
  return "#ef4444";
}

function donut(label, value) {
  const n = Number(value);
  const has = Number.isFinite(n);
  const color = scoreColor(value);
  const deg = has ? Math.round((n / 100) * 360) : 0;
  return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${color} ${deg}deg, #232a42 ${deg}deg)"><span>${has ? n : "—"}</span></div><label>${label}</label></div>`;
}

function deviceBlock(name, lh) {
  if (!lh) return "";
  const metrics = lh.metrics || {};
  const rows = Object.entries(metrics).filter(([, v]) => v).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const issues = (lh.failingAudits || []).map((t) => `<li>${t}</li>`).join("");
  return `<div class="device">
    <h3>${name}</h3>
    <div class="donuts">
      ${donut("Performance", lh.performance)}${donut("SEO", lh.seo)}${donut("Accessibility", lh.accessibility)}${donut("Best Practices", lh["best-practices"])}
    </div>
    ${rows ? `<table class="metrics"><tbody>${rows}</tbody></table>` : ""}
    ${issues ? `<div class="issues"><strong>Top issues</strong><ul>${issues}</ul></div>` : ""}
    ${lh.lhHtmlRel ? `<a class="lh-link" href="${lh.lhHtmlRel}" target="_blank">Open full Lighthouse report →</a>` : ""}
  </div>`;
}

function chip(label, url) {
  return url ? `<a class="chip on" href="${url}" target="_blank">${label}</a>` : `<span class="chip">${label}</span>`;
}

function renderReportHtml({ site, inspection, lighthouse, analysisHtml, generatedAt }) {
  const domain = hostOf(site.website);
  const soc = (k) => inspection.socials[k] || site[k] || "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${site.name || domain} — Website Report</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0b0f1d;color:#e6eaf5;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:40px 24px 80px}
  .hero{background:linear-gradient(135deg,#151c33,#1a1330);border:1px solid #262f4d;border-radius:18px;padding:28px 30px;margin-bottom:22px}
  .hero h1{margin:0 0 6px;font-size:26px}
  .hero .domain{color:#7c8db5;font-size:14px}
  .hero .meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:14px;color:#aab6d4;font-size:13px}
  .card{background:#121830;border:1px solid #232c4a;border-radius:16px;padding:24px 26px;margin-bottom:18px}
  .card h2{margin:0 0 14px;font-size:17px;color:#c3cdf0}
  h3{font-size:15px;color:#9fb0e0;margin:18px 0 10px}
  h4{font-size:14px;color:#9fb0e0;margin:14px 0 8px}
  .donuts{display:flex;gap:22px;flex-wrap:wrap;margin:10px 0}
  .donut-wrap{text-align:center}
  .donut-wrap label{display:block;margin-top:8px;font-size:12px;color:#8fa0c8}
  .donut{width:74px;height:74px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto}
  .donut span{width:56px;height:56px;border-radius:50%;background:#121830;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px}
  table.metrics{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}
  table.metrics td{padding:6px 10px;border-bottom:1px solid #1e2742;color:#bcc7e8}
  table.metrics td:last-child{text-align:right;font-weight:700;color:#e6eaf5}
  .issues{font-size:13px;color:#cfb3b3;margin-top:8px}
  .issues ul{margin:6px 0 0;padding-left:18px}
  .kv{display:grid;grid-template-columns:170px 1fr;gap:7px 14px;font-size:14px}
  .kv dt{color:#8fa0c8}.kv dd{margin:0;word-break:break-word}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{padding:5px 13px;border-radius:999px;font-size:13px;border:1px solid #2c3556;color:#5e6b95;text-decoration:none}
  .chip.on{background:#1c2b4f;border-color:#3b5bd8;color:#9db8ff;font-weight:600}
  .ai p{color:#cdd6ef}.ai ul{color:#cdd6ef}
  .lh-link{color:#8ab0ff;font-size:13px;text-decoration:none}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
  .ok{background:#143526;color:#4ade80}.bad{background:#3a1a1a;color:#f87171}
  footer{color:#5e6b95;font-size:12px;text-align:center;margin-top:30px}
</style></head><body><div class="wrap">
  <div class="hero">
    <h1>${site.name || domain}</h1>
    <div class="domain"><a href="${inspection.url}" target="_blank" style="color:#8ab0ff;text-decoration:none">${inspection.url}</a>
      ${inspection.ok ? '<span class="badge ok">online</span>' : `<span class="badge bad">${inspection.error || "unreachable"}</span>`}
      ${inspection.https ? '<span class="badge ok">HTTPS</span>' : '<span class="badge bad">no HTTPS</span>'}
    </div>
    <div class="meta">
      ${site.category ? `<span>${site.category}</span>` : ""}
      ${site.rating ? `<span>★ ${site.rating} (${site.reviews || "?"} reviews)</span>` : ""}
      ${site.phone ? `<span>${site.phone}</span>` : ""}
      ${site.address ? `<span>${site.address}</span>` : ""}
    </div>
  </div>

  <div class="card"><h2>Website snapshot</h2>
    <dl class="kv">
      <dt>Title</dt><dd>${inspection.title || "—"}</dd>
      <dt>Meta description</dt><dd>${inspection.description || "<em>missing</em>"}</dd>
      <dt>Main heading (H1)</dt><dd>${inspection.h1 || "<em>missing</em>"}</dd>
      <dt>Response time</dt><dd>${inspection.responseMs} ms</dd>
      <dt>Social preview image</dt><dd>${inspection.ogImage ? "yes" : "<em>missing (og:image)</em>"}</dd>
      <dt>Tech detected</dt><dd>${(inspection.tech || []).join(", ") || "—"}</dd>
      <dt>Emails on site</dt><dd>${(inspection.emails || []).join(", ") || site.email || "—"}</dd>
    </dl>
  </div>

  <div class="card"><h2>Lighthouse audit</h2>
    ${deviceBlock("Desktop", lighthouse.desktop)}
    ${deviceBlock("Mobile", lighthouse.mobile)}
    ${!lighthouse.desktop && !lighthouse.mobile ? '<p style="color:#8fa0c8">Lighthouse could not audit this site.</p>' : ""}
  </div>

  <div class="card"><h2>Social media presence</h2>
    <div class="chips">
      ${chip("Facebook", soc("facebook"))}${chip("Instagram", soc("instagram"))}${chip("LinkedIn", soc("linkedin"))}
      ${chip("X / Twitter", soc("twitter"))}${chip("YouTube", soc("youtube"))}${chip("TikTok", soc("tiktok"))}
      ${chip("Pinterest", soc("pinterest"))}${chip("WhatsApp", soc("whatsapp") || (site.whatsapp_status === "yes" ? `https://wa.me/${String(site.phone || "").replace(/\D/g, "")}` : ""))}
    </div>
  </div>

  <div class="card ai"><h2>Analysis & recommendations</h2>${analysisHtml}</div>
  <footer>Generated ${generatedAt} · Lead Ops AI agent</footer>
</div></body></html>`;
}

// ---- jobs ----------------------------------------------------------------------
function readJobs() {
  return readJson(JOBS_FILE, {});
}

function patchJob(id, patch) {
  const jobs = readJobs();
  jobs[id] = { ...(jobs[id] || {}), ...patch, updatedAt: new Date().toISOString() };
  // keep the registry small
  const ids = Object.keys(jobs).sort();
  while (ids.length > 40) delete jobs[ids.shift()];
  writeJson(JOBS_FILE, jobs);
  return jobs[id];
}

function getJob(id) {
  return readJobs()[id] || null;
}

function listReports() {
  ensureDirs();
  return fs.readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => {
      const full = path.join(REPORTS_DIR, f);
      return { file: f, mtime: fs.statSync(full).mtimeMs, createdAt: new Date(fs.statSync(full).mtimeMs).toISOString() };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function safeReportPath(name) {
  const file = path.resolve(REPORTS_DIR, name);
  if (!file.startsWith(path.resolve(REPORTS_DIR) + path.sep)) throw new Error("Invalid report path");
  return file;
}

// ---- main entry ------------------------------------------------------------------
// sites: [{ name, website, ...leadFields }] — capped at 5. Returns a job id
// immediately; the work continues in the background inside this server process.
function startReportJob(sites, { devices = ["desktop", "mobile"], onLog } = {}) {
  ensureDirs();
  const valid = (sites || []).filter((s) => s && s.website).slice(0, MAX_SITES);
  if (!valid.length) throw new Error("No websites to analyze (each site needs a website URL)");
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  patchJob(id, {
    id, status: "running", startedAt: new Date().toISOString(), log: [],
    sites: valid.map((s) => ({ name: s.name || "", domain: hostOf(s.website) })),
    results: [],
  });

  const log = (msg) => {
    const job = getJob(id) || {};
    patchJob(id, { log: [...(job.log || []), `${new Date().toISOString().slice(11, 19)} ${msg}`].slice(-50) });
    if (onLog) onLog(msg);
  };

  (async () => {
    // Cancellation is file-based (cancelRequested in the job registry) so it
    // works from any route bundle; checked at every stage boundary.
    const assertNotCancelled = () => {
      if ((getJob(id) || {}).cancelRequested) throw Object.assign(new Error("cancelled"), { cancelled: true });
    };
    try {
      const workDir = path.join(AGENT_DIR, "work", id);
      fs.mkdirSync(workDir, { recursive: true });

      log(`Inspecting ${valid.length} website(s)…`);
      const inspections = await Promise.all(valid.map((s) => inspectWebsite(s.website)));
      assertNotCancelled();

      const lhByDevice = {};
      for (const device of devices) {
        lhByDevice[device] = await runLighthouseBatch(valid, device, workDir, log, id);
        assertNotCancelled();
      }

      const results = [];
      for (let i = 0; i < valid.length; i++) {
        assertNotCancelled();
        const site = valid[i];
        const domain = hostOf(site.website);
        const lighthouse = {};
        for (const device of devices) {
          const row = lhByDevice[device]?.[domain];
          if (row) {
            // copy the full Lighthouse HTML next to the report so links survive cleanup
            if (row.lhHtml) {
              const src = path.join(workDir, `lh-${device}`, row.lhHtml);
              const destName = `${domain}-${device}-lighthouse.html`;
              try {
                fs.copyFileSync(src, path.join(REPORTS_DIR, destName));
                row.lhHtmlRel = destName;
              } catch {}
            }
            lighthouse[device] = row;
          }
        }
        log(`Writing AI analysis for ${domain}…`);
        const analysis = await aiAnalysis(site, inspections[i], lighthouse);
        const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
        const html = renderReportHtml({ site, inspection: inspections[i], lighthouse, analysisHtml: mdToHtml(analysis), generatedAt });
        const fileName = `${domain.replace(/[^a-z0-9.-]/gi, "_")}-${Date.now()}.html`;
        fs.writeFileSync(path.join(REPORTS_DIR, fileName), html, "utf8");
        const summary = {
          domain, name: site.name || domain, report: fileName,
          desktopPerf: lighthouse.desktop?.performance ?? null, desktopSeo: lighthouse.desktop?.seo ?? null,
          mobilePerf: lighthouse.mobile?.performance ?? null, mobileSeo: lighthouse.mobile?.seo ?? null,
          online: inspections[i].ok,
        };
        results.push(summary);
        const job = getJob(id) || {};
        patchJob(id, { results: [...(job.results || []), summary] });
        log(`Report ready: ${fileName}`);
      }

      // clean the heavy lighthouse work dir, keep the reports
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
      patchJob(id, { status: "done", finishedAt: new Date().toISOString() });
      log("All reports generated.");
    } catch (err) {
      if (err && err.cancelled) {
        try { fs.rmSync(path.join(AGENT_DIR, "work", id), { recursive: true, force: true }); } catch {}
        patchJob(id, { status: "cancelled", activePid: null, finishedAt: new Date().toISOString() });
        log("Job cancelled.");
      } else {
        patchJob(id, { status: "failed", error: String(err && err.message || err).slice(0, 400) });
      }
    }
  })();

  return id;
}

// Cancel a running report job: flag it (the job loop checks at every stage
// boundary) and kill the in-flight Lighthouse worker so it stops immediately.
function cancelJob(id) {
  const job = getJob(id);
  if (!job) return null;
  if (job.status !== "running") return job;
  const patched = patchJob(id, { cancelRequested: true });
  if (job.activePid) {
    try { require("./store.cjs").killTree(job.activePid); } catch {}
  }
  return patched;
}

module.exports = { startReportJob, getJob, cancelJob, listReports, safeReportPath, REPORTS_DIR, inspectWebsite, MAX_SITES };
