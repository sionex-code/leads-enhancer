#!/usr/bin/env node
// Contact-detail enricher: visits each lead's website (plain HTTP, no browser),
// crawls a few likely pages (contact/about/etc), extracts emails + social links,
// and writes an enriched CSV next to the input.
//
// Usage:
//   node enrich.js                                  # latest CSV in ./output
//   node enrich.js output/leads.csv                 # specific file
//   node enrich.js --watch                          # follow a CSV the scraper is still writing
//   node enrich.js output/leads.csv --concurrency 10 --maxPages 5
//
// Resume: progress is appended to <input>.enrich-state.jsonl after every site.
// Re-running the same input skips everything already done (use --force to redo).

const fs = require("fs");
const path = require("path");

// ---- CLI args ----------------------------------------------------------------
const VALUE_FLAGS = new Set(["--concurrency", "--maxPages", "--timeout"]);
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

const CONCURRENCY = parseInt(flagValue("--concurrency", "8"), 10);
const MAX_PAGES = parseInt(flagValue("--maxPages", "4"), 10); // pages crawled per site
const TIMEOUT = parseInt(flagValue("--timeout", "10000"), 10); // per request, ms
const WATCH = flags.has("--watch"); // keep following the CSV while the scraper appends
const FORCE = flags.has("--force"); // ignore saved state, re-enrich everything

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const EXTRA_HEADERS = [
  "email",
  "allEmails",
  "contactPage",
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "enrichStatus",
];

// ---- tiny CSV ------------------------------------------------------------------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
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

// ---- email / link extraction -----------------------------------------------------
const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL_RE =
  /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|ico|mp4)$|@(example\.|sentry\.|.*\.sentry\.|wixpress\.|sentry-next\.|godaddy\.|domain\.com|email\.com|yourdomain|2x\b)|^[0-9a-f]{16,}@/i;

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function extractEmails(html) {
  const out = new Set();
  const text = decodeEntities(html);
  // mailto: links first (may be URL-encoded)
  for (const m of text.matchAll(/mailto:([^"'?\s<>]+)/gi)) {
    try {
      const e = decodeURIComponent(m[1]).toLowerCase().trim();
      if (EMAIL_RE.test(e)) out.add(e.match(EMAIL_RE)[0]);
      EMAIL_RE.lastIndex = 0;
    } catch {}
  }
  for (const m of text.matchAll(EMAIL_RE)) out.add(m[0].toLowerCase());
  return [...out].filter((e) => !BAD_EMAIL_RE.test(e));
}

const SOCIAL = {
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.\-/%]+/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.\-/%]+/i,
  linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[A-Za-z0-9_.\-/%]+/i,
  twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_.\-/%]+/i,
};
const SOCIAL_JUNK =
  /\/(sharer|share|intent|plugins|tr\?|widgets)\b|(facebook|instagram|twitter|x)\.com\/(wix|wordpressdotcom|wordpress|squarespace|godaddy|shopify|weebly)\b/i;

function extractSocial(html, into) {
  for (const [key, re] of Object.entries(SOCIAL)) {
    if (into[key]) continue;
    const m = html.match(re);
    if (m && !SOCIAL_JUNK.test(m[0])) into[key] = m[0].replace(/[).,'"\\]+$/, "");
  }
}

// Links worth crawling beyond the homepage, ordered by how likely they hold an email.
const CONTACT_WORDS = /contact|kontakt|impressum|about|team|reach|support|connect/i;

function extractCrawlLinks(html, baseUrl) {
  const links = [];
  const host = hostOf(baseUrl);
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = decodeEntities(m[1]);
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    if (!CONTACT_WORDS.test(href)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (!/^https?:$/.test(u.protocol)) continue;
      if (hostOf(u.href) !== host) continue;
      u.hash = "";
      links.push(u.href);
    } catch {}
  }
  // contact pages first, then the rest, deduped
  const uniq = [...new Set(links)];
  uniq.sort((a, b) => (/contact|kontakt/i.test(b) ? 1 : 0) - (/contact|kontakt/i.test(a) ? 1 : 0));
  return uniq;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

// ---- fetching ---------------------------------------------------------------------
async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || (ct && !/text\/html|application\/xhtml|text\/plain/i.test(ct))) {
      return { html: "", finalUrl: res.url || url, status: res.status };
    }
    const html = (await res.text()).slice(0, 1_500_000); // cap huge pages
    return { html, finalUrl: res.url || url, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

// Crawl one site: homepage -> up to MAX_PAGES contact-ish pages. Stops early once
// an email on the site's own domain is found (the best possible answer).
async function enrichSite(website) {
  const result = {
    email: "",
    allEmails: "",
    contactPage: "",
    facebook: "",
    instagram: "",
    linkedin: "",
    twitter: "",
    enrichStatus: "",
  };
  const emails = new Set();
  const siteHost = hostOf(website);
  let queue = [website];
  const visited = new Set();
  let fetched = 0;
  let firstError = "";

  while (queue.length && fetched < MAX_PAGES) {
    const url = queue.shift();
    const key = url.replace(/\/+$/, "");
    if (visited.has(key)) continue;
    visited.add(key);
    fetched++;
    try {
      const { html, finalUrl } = await fetchHtml(url);
      if (!html) continue;
      const found = extractEmails(html);
      for (const e of found) emails.add(e);
      if (found.length && !result.contactPage && CONTACT_WORDS.test(finalUrl)) {
        result.contactPage = finalUrl;
      }
      extractSocial(html, result);
      if (fetched === 1) {
        const links = extractCrawlLinks(html, finalUrl);
        if (!result.contactPage && links.length) result.contactPage = links[0];
        queue = links;
      }
      // Stop early: we already have an email on the business's own domain.
      if ([...emails].some((e) => siteHost && e.endsWith("@" + siteHost))) break;
    } catch (err) {
      if (!firstError) firstError = (err.cause?.code || err.name || err.message || "fetch failed") + "";
    }
  }

  const list = [...emails];
  // Prefer an email on the site's own domain, then info@/contact@, then the rest.
  list.sort((a, b) => score(b) - score(a));
  function score(e) {
    let s = 0;
    if (siteHost && e.endsWith("@" + siteHost)) s += 10;
    if (/^(info|contact|hello|office|sales|admin)@/.test(e)) s += 3;
    if (/@(gmail|yahoo|hotmail|outlook|aol)\./.test(e)) s -= 1;
    return s;
  }

  result.email = list[0] || "";
  result.allEmails = list.join(" | ");
  result.enrichStatus = list.length
    ? `ok (${list.length} email${list.length > 1 ? "s" : ""})`
    : firstError
      ? `error: ${firstError}`.slice(0, 80)
      : "no email found";
  return result;
}

// ---- state (resume) -----------------------------------------------------------------
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

const siteKey = (website) => {
  const h = hostOf(website);
  return h || website.trim().toLowerCase();
};

// ---- main -----------------------------------------------------------------------------
(async () => {
  // Resolve input: explicit path, or the most recent CSV in ./output.
  let input = positionals[0];
  if (!input) {
    const dir = path.join(__dirname, "output");
    const csvs = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".csv") && !f.includes("-enriched"))
          .map((f) => path.join(dir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    if (!csvs.length) {
      console.error("  No CSV found in ./output. Pass a file: node enrich.js output/leads.csv");
      process.exit(1);
    }
    input = csvs[0];
  }
  input = path.resolve(input);
  if (!fs.existsSync(input)) {
    console.error(`  File not found: ${input}`);
    process.exit(1);
  }

  const outFile = input.replace(/\.csv$/i, "-enriched.csv");
  const stateFile = input.replace(/\.csv$/i, ".enrich-state.jsonl");
  const state = loadState(stateFile); // siteKey -> result (resume across runs)

  console.log(`\n  Input : ${input}`);
  console.log(`  Output: ${outFile}`);
  console.log(`  Resume: ${state.size ? state.size + " sites already done (use --force to redo)" : "fresh run"}`);
  console.log(`  Mode  : concurrency ${CONCURRENCY}, ${MAX_PAGES} pages/site, ${TIMEOUT}ms timeout${WATCH ? ", WATCH" : ""}\n`);

  let headers = [];
  let rows = []; // array of objects, input order
  let webCol = "website";

  function readInput() {
    const parsed = parseCsv(fs.readFileSync(input, "utf8"));
    if (!parsed.length) return 0;
    headers = parsed[0];
    webCol = headers.includes("website") ? "website" : headers.find((h) => /web|url|site/i.test(h)) || "website";
    const prev = rows.length;
    rows = parsed.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
      return obj;
    });
    return rows.length - prev;
  }

  // Rebuild the enriched CSV from input rows + state map. Rows stay in scrape order;
  // sites still pending just have empty enrichment columns until their turn.
  function flushCsv() {
    const outHeaders = [...headers, ...EXTRA_HEADERS.filter((h) => !headers.includes(h))];
    const lines = [String.fromCharCode(0xfeff) + outHeaders.join(",") + "\r\n"];
    for (const row of rows) {
      const res = row[webCol] ? state.get(siteKey(row[webCol])) : { enrichStatus: "no website" };
      const merged = { ...row, ...(res || {}) };
      if (!row[webCol]) merged.enrichStatus = "no website";
      lines.push(outHeaders.map((h) => csvEsc(merged[h])).join(",") + "\r\n");
    }
    fs.writeFileSync(outFile, lines.join(""), "utf8");
  }

  readInput();
  let processed = 0;
  let withEmail = 0;

  // Work queue of unique site keys not yet in state.
  const queued = new Set();
  const queue = [];
  function enqueueNew() {
    for (const row of rows) {
      const w = (row[webCol] || "").trim();
      if (!w) continue;
      const key = siteKey(w);
      if (state.has(key) || queued.has(key)) continue;
      queued.add(key);
      queue.push({ key, website: w });
    }
  }
  enqueueNew();
  console.log(`  ${rows.length} rows, ${queue.length} unique sites to crawl\n`);

  let active = 0;
  let stopWatch = false;

  async function worker() {
    while (true) {
      const job = queue.shift();
      if (!job) return;
      active++;
      let result;
      try {
        result = await enrichSite(job.website);
      } catch (err) {
        result = { ...EXTRA_HEADERS.reduce((o, h) => ((o[h] = ""), o), {}), enrichStatus: "error: " + err.message };
      }
      state.set(job.key, result);
      fs.appendFileSync(stateFile, JSON.stringify({ key: job.key, website: job.website, result }) + "\n", "utf8");
      processed++;
      if (result.email) withEmail++;
      const tag = result.email || result.enrichStatus;
      console.log(`  [${processed}] ${job.key}  ->  ${tag}`);
      if (processed % 5 === 0) flushCsv();
      active--;
    }
  }

  async function runQueue() {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  if (!WATCH) {
    await runQueue();
  } else {
    // Watch mode: keep re-reading the input CSV (the scraper appends to it live)
    // and enrich new rows as they arrive. Stops after ~60s with nothing new.
    let idleChecks = 0;
    process.on("SIGINT", () => {
      stopWatch = true;
      console.log("\n  Stopping (state saved — re-run to resume).");
    });
    while (!stopWatch && idleChecks < 12) {
      await runQueue();
      flushCsv();
      await new Promise((r) => setTimeout(r, 5000));
      readInput();
      enqueueNew();
      idleChecks = queue.length ? 0 : idleChecks + 1;
    }
  }

  readInput();
  flushCsv();
  console.log(`\n  Done. ${processed} sites crawled this run, ${withEmail} with email.`);
  console.log(`  Enriched CSV: ${outFile}\n`);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
