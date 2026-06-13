#!/usr/bin/env node
// Builds one HTML dashboard for a set of leads: business details, contact info,
// desktop Lighthouse scores, mobile Lighthouse scores, and links to full reports.
//
// Usage:
//   node report.js
//   node report.js output/leads-enriched.csv
//   node report.js output/leads-enriched.csv --desktopLighthouse output/leads-enriched-lighthouse-desktop.csv --mobileLighthouse output/leads-enriched-lighthouse-mobile.csv --out output/report.html

const fs = require("fs");
const path = require("path");

const VALUE_FLAGS = new Set(["--lighthouse", "--desktopLighthouse", "--mobileLighthouse", "--out", "--title"]);
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
  node report.js [leads.csv] [flags]

Flags:
  --desktopLighthouse FILE  Desktop Lighthouse summary CSV
  --mobileLighthouse FILE   Mobile Lighthouse summary CSV
  --lighthouse FILE         Backward-compatible alias for desktop Lighthouse CSV
  --out FILE                HTML report path
  --title TEXT              Report title
`);
  process.exit(0);
}

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

function toObjects(parsed) {
  if (!parsed.length) return { headers: [], rows: [] };
  const headers = parsed[0];
  const rows = parsed.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
  return { headers, rows };
}

const hostOf = (url) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : "http://" + url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return (url || "").trim().toLowerCase();
  }
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || "";
}

function defaultLighthouseFile(input, device) {
  const base = input.replace(/\.csv$/i, "");
  if (device === "mobile") return firstExisting([`${base}-lighthouse-mobile.csv`]);
  return firstExisting([`${base}-lighthouse-desktop.csv`, `${base}-lighthouse.csv`]);
}

function loadLighthouse(file) {
  const map = new Map();
  if (!file || !fs.existsSync(file)) return { file: "", map, rows: [] };
  file = path.resolve(file);
  const { rows } = toObjects(parseCsv(fs.readFileSync(file, "utf8")));
  for (const r of rows) {
    const key = r.domain || hostOf(r.website);
    if (!key) continue;
    r.__summaryDir = path.dirname(file);
    map.set(key, r);
  }
  return { file, map, rows };
}

function scoreBadge(label, v) {
  if (v === "" || v == null || isNaN(+v)) {
    return `<span class="badge na" title="${esc(label)}">${esc(label[0].toUpperCase())} -</span>`;
  }
  const n = +v;
  const cls = n >= 90 ? "good" : n >= 50 ? "avg" : "poor";
  return `<span class="badge ${cls}" title="${esc(label)}">${esc(label[0].toUpperCase())} ${n}</span>`;
}

function scoreGroup(label, row) {
  if (!row) {
    return `<div class="score-set muted"><span class="device">${esc(label)}</span><span class="badge na">not audited</span></div>`;
  }
  return `
    <div class="score-set">
      <span class="device">${esc(label)}</span>
      <div class="badges">
        ${scoreBadge("performance", row.performance)}
        ${scoreBadge("accessibility", row.accessibility)}
        ${scoreBadge("best-practices", row["best-practices"])}
        ${scoreBadge("seo", row.seo)}
      </div>
    </div>`;
}

function reportHref(lh, out) {
  if (!lh || !lh.reportHtml) return "";
  const raw = lh.reportHtml;
  const summaryDir = lh.__summaryDir || process.cwd();
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [
        path.resolve(summaryDir, raw),
        path.resolve(summaryDir, "lighthouse", raw),
        path.resolve(summaryDir, "lighthouse", "desktop", raw),
        path.resolve(summaryDir, "lighthouse", "mobile", raw),
      ];
  const abs = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  return path.relative(path.dirname(out), abs).replace(/\\/g, "/");
}

function average(rows, col) {
  const nums = rows
    .filter((r) => r.analyzeStatus === "ok")
    .map((r) => +r[col])
    .filter((n) => !isNaN(n));
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : "-";
}

(async () => {
  let input = positionals[0];
  if (!input) {
    const dir = path.join(__dirname, "output");
    const csvs = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".csv") && !f.includes("-lighthouse"))
          .map((f) => path.join(dir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    input = csvs.find((f) => f.includes("-enriched")) || csvs[0];
    if (!input) {
      console.error("  No CSV found in ./output. Pass a file: node report.js output/leads.csv");
      process.exit(1);
    }
  }
  input = path.resolve(input);
  if (!fs.existsSync(input)) {
    console.error(`  File not found: ${input}`);
    process.exit(1);
  }

  const { rows } = toObjects(parseCsv(fs.readFileSync(input, "utf8")));
  const desktopFile =
    flagValue("--desktopLighthouse", "") ||
    flagValue("--lighthouse", "") ||
    defaultLighthouseFile(input, "desktop");
  const mobileFile = flagValue("--mobileLighthouse", "") || defaultLighthouseFile(input, "mobile");
  const desktop = loadLighthouse(desktopFile);
  const mobile = loadLighthouse(mobileFile);

  const out = path.resolve(flagValue("--out", input.replace(/\.csv$/i, "-report.html")));
  const title = flagValue("--title", path.basename(input).replace(/\.csv$/i, ""));

  const cards = rows.map((r) => {
    const website = r.website || "";
    const dom = website ? hostOf(website) : "";
    const d = dom ? desktop.map.get(dom) : null;
    const m = dom ? mobile.map.get(dom) : null;
    const socials = [
      ["facebook", r.facebook],
      ["instagram", r.instagram],
      ["linkedin", r.linkedin],
      ["twitter", r.twitter],
    ].filter(([, v]) => v);
    const dHref = reportHref(d, out);
    const mHref = reportHref(m, out);
    const rating = r.rating ? `Rating ${esc(r.rating)}${r.reviews ? ` (${esc(r.reviews)})` : ""}` : "";

    return `
    <article class="card" data-perf="${d ? esc(d.performance || -1) : -1}" data-mobile="${m ? esc(m.performance || -1) : -1}">
      <header>
        <h2>${esc(r.name || dom || "Unknown")}</h2>
        <span class="cat">${esc(r.category || "")}${rating ? ` | ${rating}` : ""}</span>
      </header>
      <div class="scores">
        ${scoreGroup("Desktop", d)}
        ${scoreGroup("Mobile", m)}
      </div>
      <ul class="meta">
        ${website ? `<li><span>Site</span><a href="${esc(/^https?:/i.test(website) ? website : "http://" + website)}" target="_blank">${esc(dom || website)}</a></li>` : ""}
        ${r.phone ? `<li><span>Phone</span><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>${r.whatsappExists === "yes" ? ` <a href="https://wa.me/${esc((r.whatsappNumber || "").replace(/\D/g, ""))}" target="_blank" class="wa-tag" title="On WhatsApp">WhatsApp ✓</a>` : r.whatsappExists === "no" ? ` <span class="wa-tag wa-no" title="Not on WhatsApp">no WhatsApp</span>` : ""}</li>` : ""}
        ${r.email ? `<li><span>Email</span><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></li>` : ""}
        ${r.address ? `<li><span>Address</span>${esc(r.address)}</li>` : ""}
        ${r.contactPage ? `<li><span>Contact</span><a href="${esc(r.contactPage)}" target="_blank">Contact page</a></li>` : ""}
      </ul>
      ${socials.length ? `<div class="social">${socials.map(([k, v]) => `<a href="${esc(v)}" target="_blank">${k}</a>`).join("")}</div>` : ""}
      <div class="links">
        ${dHref ? `<a href="${esc(dHref)}" target="_blank">Desktop audit report</a>` : ""}
        ${mHref ? `<a href="${esc(mHref)}" target="_blank">Mobile audit report</a>` : ""}
      </div>
    </article>`;
  });

  const desktopOk = desktop.rows.filter((r) => r.analyzeStatus === "ok");
  const mobileOk = mobile.rows.filter((r) => r.analyzeStatus === "ok");
  const withEmail = rows.filter((r) => r.email).length;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Leads Report</title>
<style>
  :root { --bg:#f6f7f9; --panel:#ffffff; --line:#d9dee7; --txt:#1f2937; --mut:#687386; --good:#0c8f53; --avg:#b56b00; --poor:#c7352a; --acc:#1456b8; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif; }
  header.top { padding:24px 32px; border-bottom:1px solid var(--line); background:var(--panel); }
  header.top h1 { margin:0 0 6px; font-size:22px; }
  header.top .sub { color:var(--mut); font-size:13px; }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin-top:16px; }
  .stat { border:1px solid var(--line); border-radius:8px; padding:10px 14px; min-width:112px; background:#fbfcfe; }
  .stat .n { font-size:22px; font-weight:700; }
  .stat .l { color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:0; }
  .controls { padding:16px 32px; display:flex; gap:8px; flex-wrap:wrap; }
  .controls input { background:var(--panel); border:1px solid var(--line); color:var(--txt); padding:9px 12px; border-radius:8px; width:min(340px, 100%); font-size:14px; }
  .controls button { background:var(--panel); border:1px solid var(--line); color:var(--txt); padding:9px 12px; border-radius:8px; cursor:pointer; font-size:13px; }
  .controls button:hover { border-color:var(--acc); color:var(--acc); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:14px; padding:0 32px 40px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; display:flex; flex-direction:column; gap:12px; min-width:0; }
  .card header { display:flex; flex-direction:column; gap:2px; }
  .card h2 { margin:0; font-size:16px; line-height:1.25; }
  .card .cat { color:var(--mut); font-size:12px; }
  .scores { display:grid; gap:8px; }
  .score-set { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .score-set .device { color:var(--mut); font-size:12px; width:54px; flex:0 0 auto; }
  .badges { display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
  .badge { font-size:12px; font-weight:700; padding:3px 7px; border-radius:8px; color:#fff; min-width:34px; text-align:center; }
  .badge.good { background:var(--good); } .badge.avg { background:var(--avg); } .badge.poor { background:var(--poor); }
  .badge.na { background:#e7eaf0; color:var(--mut); }
  ul.meta { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; font-size:13px; }
  ul.meta li { display:grid; grid-template-columns:66px minmax(0,1fr); gap:8px; }
  ul.meta span { color:var(--mut); }
  a { color:var(--acc); text-decoration:none; word-break:break-word; }
  a:hover { text-decoration:underline; }
  .social, .links { display:flex; gap:8px; flex-wrap:wrap; }
  .social a, .links a { font-size:12px; border:1px solid var(--line); padding:4px 8px; border-radius:8px; background:#fbfcfe; }
  .wa-tag { font-size:11px; font-weight:700; padding:1px 7px; border-radius:10px; background:#dcfce7; color:#15803d; margin-left:6px; }
  .wa-tag.wa-no { background:#fee2e2; color:#b91c1c; }
  @media (max-width: 560px) {
    header.top, .controls { padding-left:16px; padding-right:16px; }
    .grid { grid-template-columns:1fr; padding-left:16px; padding-right:16px; }
  }
</style>
</head>
<body>
  <header class="top">
    <h1>${esc(title)}</h1>
    <div class="sub">Generated ${new Date().toLocaleString()} | ${rows.length} leads</div>
    <div class="stats">
      <div class="stat"><div class="n">${rows.length}</div><div class="l">Leads</div></div>
      <div class="stat"><div class="n">${withEmail}</div><div class="l">With email</div></div>
      <div class="stat"><div class="n">${desktopOk.length}</div><div class="l">Desktop audits</div></div>
      <div class="stat"><div class="n">${mobileOk.length}</div><div class="l">Mobile audits</div></div>
      <div class="stat"><div class="n">${average(desktop.rows, "seo")}</div><div class="l">Desktop SEO</div></div>
      <div class="stat"><div class="n">${average(mobile.rows, "seo")}</div><div class="l">Mobile SEO</div></div>
    </div>
  </header>
  <div class="controls">
    <input id="q" type="search" placeholder="Filter by name, domain, email">
    <button onclick="sortBy('perf')">Sort desktop performance</button>
    <button onclick="sortBy('mobile')">Sort mobile performance</button>
  </div>
  <main class="grid" id="grid">
    ${cards.join("\n")}
  </main>
<script>
  const grid = document.getElementById('grid');
  const cards = [...grid.children];
  document.getElementById('q').addEventListener('input', (e) => {
    const t = e.target.value.toLowerCase();
    for (const c of cards) c.style.display = c.textContent.toLowerCase().includes(t) ? '' : 'none';
  });
  let asc = false;
  function sortBy(key) {
    asc = !asc;
    const attr = key === 'mobile' ? 'mobile' : 'perf';
    cards.sort((a, b) => ((+a.dataset[attr] || -1) - (+b.dataset[attr] || -1)) * (asc ? 1 : -1));
    for (const c of cards) grid.appendChild(c);
  }
</script>
</body>
</html>`;

  fs.writeFileSync(out, html, "utf8");
  console.log(`\n  Report written: ${out}`);
  console.log(`  ${rows.length} leads, ${withEmail} with email, ${desktopOk.length} desktop audits, ${mobileOk.length} mobile audits.\n`);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
