#!/usr/bin/env node
// Crawlee-based contact-detail enricher (fast alternative to enrich.cjs).
//
// Two passes, both managed by Crawlee's autoscaling pool:
//   1. CheerioCrawler  — plain HTTP, homepage + up to 2 contact/about pages.
//      Covers the majority of small-business sites in a few hundred ms each.
//   2. PlaywrightCrawler — only for the sites pass 1 found NO email on. Loads
//      the page in the already-installed Chrome (channel: 'chrome', shared with
//      patchright), scrolls to the bottom so lazy-loaded footers/contact blocks
//      render, then grabs emails/socials off the live DOM. Stops the moment an
//      email appears.
//
// This is a DROP-IN for enrich.cjs: identical input/output contract so the
// dashboard, whatsapp, audit and report stages all work unchanged.
//   - reads the same CSV (auto-detects the website column)
//   - writes <input>-enriched.csv with the same EXTRA_HEADERS columns
//   - appends progress to <input>.enrich-state.jsonl (resume; --force to redo)
//
// Usage:
//   node enrich-crawlee.js                            # latest CSV in ./output
//   node enrich-crawlee.js output/leads.csv --concurrency 30 --browserConcurrency 4
//   node enrich-crawlee.js output/leads.csv --noBrowser   # HTTP pass only
//   node enrich-crawlee.js output/leads.csv --headful|--headless

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheerioCrawler, PlaywrightCrawler, playwrightUtils, Configuration, log } from "crawlee";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep everything in memory — no ./storage request-queue dirs left behind, and
// every run starts clean (our own .enrich-state.jsonl is the resume source).
Configuration.getGlobalConfig().set("persistStorage", false);
log.setLevel(log.LEVELS.WARNING);

// ---- CLI args (mirrors enrich.cjs) -------------------------------------------
const VALUE_FLAGS = new Set(["--concurrency", "--browserConcurrency", "--timeout", "--scrollSecs"]);
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

const CONCURRENCY = parseInt(flagValue("--concurrency", "30"), 10); // HTTP pass
const BROWSER_MAX = parseInt(flagValue("--browserConcurrency", "8"), 10); // scroll pass tabs (5-10 sweet spot)
const TIMEOUT = parseInt(flagValue("--timeout", "15000"), 10); // per request, ms
const SCROLL_SECS = parseInt(flagValue("--scrollSecs", "5"), 10); // max scroll time per site (early-exits on email)
const FORCE = flags.has("--force");
const USE_BROWSER = !flags.has("--noBrowser");
const BROWSER_HEADLESS = flags.has("--headless")
  ? true
  : flags.has("--headful")
    ? false
    : process.platform !== "win32";

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
  "youtube",
  "tiktok",
  "pinterest",
  "whatsapp",
  "telegram",
  "enrichStatus",
];

// ---- tiny CSV (identical to enrich.cjs) --------------------------------------
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

// ---- email / link extraction (identical rules to enrich.cjs) -----------------
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

// Cloudflare hides emails as hex behind a one-byte XOR key (data-cfemail / the
// /cdn-cgi/l/email-protection#hex link). The address is already in the HTML, so
// decode it here instead of rendering the page just to read it.
function decodeCfEmail(hex) {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out.toLowerCase();
  } catch {
    return "";
  }
}

// Bracketed obfuscation: "name [at] domain [dot] com" -> "name@domain.com".
// Limited to bracketed forms so we don't mangle ordinary prose ("meet at 5").
function deobfuscateEmails(s) {
  return s
    .replace(/\s*[\[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[\[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi, ".");
}

// Pull `email` out of schema.org JSON-LD blocks (Organization/LocalBusiness),
// walking nested objects/arrays.
function emailsFromJsonLd(html, out) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      for (const [k, v] of Object.entries(node)) {
        if (k.toLowerCase() === "email" && typeof v === "string") {
          const e = v.replace(/^mailto:/i, "").toLowerCase().trim();
          if (EMAIL_RE.test(e)) out.add(e.match(EMAIL_RE)[0]);
          EMAIL_RE.lastIndex = 0;
        } else if (v && typeof v === "object") stack.push(v);
      }
    }
  }
}

function extractEmails(html) {
  const out = new Set();
  // Cloudflare-protected addresses (data-cfemail="..." and email-protection#hex).
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-fA-F]+)["']/g)) {
    const e = decodeCfEmail(m[1]);
    if (EMAIL_RE.test(e)) out.add(e.match(EMAIL_RE)[0]);
    EMAIL_RE.lastIndex = 0;
  }
  for (const m of html.matchAll(/email-protection#([0-9a-fA-F]+)/g)) {
    const e = decodeCfEmail(m[1]);
    if (EMAIL_RE.test(e)) out.add(e.match(EMAIL_RE)[0]);
    EMAIL_RE.lastIndex = 0;
  }
  emailsFromJsonLd(html, out);

  const text = deobfuscateEmails(decodeEntities(html));
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
  youtube:
    /https?:\/\/(?:www\.)?youtube\.com\/(?:@[A-Za-z0-9_.\-]+|c\/[A-Za-z0-9_.\-]+|channel\/[A-Za-z0-9_\-]+|user\/[A-Za-z0-9_.\-]+)/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.\-]+/i,
  pinterest: /https?:\/\/(?:[a-z]{2,3}\.)?pinterest\.[a-z.]+\/[A-Za-z0-9_.\-/%]+/i,
  whatsapp: /https?:\/\/(?:wa\.me\/[0-9]+|(?:api|chat)\.whatsapp\.com\/[A-Za-z0-9?=&%._\-/]+)/i,
  telegram: /https?:\/\/(?:www\.)?t\.me\/[A-Za-z0-9_]+/i,
};
const SOCIAL_JUNK =
  /\/(sharer|share|intent|plugins|tr\?|widgets|embed)\b|youtube\.com\/(watch|results|embed|shorts|playlist)\b|(facebook|instagram|twitter|x|youtube|tiktok|pinterest)\.com\/(wix|wordpressdotcom|wordpress|squarespace|godaddy|shopify|weebly)\b/i;

function extractSocial(html, into) {
  for (const [key, re] of Object.entries(SOCIAL)) {
    if (into[key]) continue;
    const m = html.match(re);
    if (m && !SOCIAL_JUNK.test(m[0])) into[key] = m[0].replace(/[).,'"\\]+$/, "");
  }
}

const CONTACT_WORDS = /contact|kontakt|impressum|about|team|reach|support|connect/i;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

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
  const uniq = [...new Set(links)];
  uniq.sort((a, b) => (/contact|kontakt/i.test(b) ? 1 : 0) - (/contact|kontakt/i.test(a) ? 1 : 0));
  return uniq;
}

const siteKey = (website) => {
  const h = hostOf(website);
  return h || website.trim().toLowerCase();
};

const normUrl = (site) => {
  let s = (site || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    new URL(s);
    return s;
  } catch {
    return "";
  }
};

// Finalise the per-site aggregate into the EXTRA_HEADERS result shape, reusing
// enrich.cjs's email scoring (own-domain > info@/contact@ > free mailboxes).
function finalizeResult(agg) {
  const siteHost = agg.host;
  const list = [...agg.emails];
  list.sort((a, b) => score(b) - score(a));
  function score(e) {
    let s = 0;
    if (siteHost && e.endsWith("@" + siteHost)) s += 10;
    if (/^(info|contact|hello|office|sales|admin)@/.test(e)) s += 3;
    if (/@(gmail|yahoo|hotmail|outlook|aol)\./.test(e)) s -= 1;
    return s;
  }
  const result = { ...EXTRA_HEADERS.reduce((o, h) => ((o[h] = ""), o), {}) };
  Object.assign(result, agg.socials);
  result.contactPage = agg.contactPage || "";
  result.email = list[0] || "";
  result.allEmails = list.join(" | ");
  result.enrichStatus = list.length
    ? `ok (${list.length} email${list.length > 1 ? "s" : ""}${agg.viaBrowser ? ", via browser" : ""})`
    : agg.error
      ? `error: ${agg.error}`.slice(0, 90)
      : "no email found";
  return result;
}

// ---- state (resume) — same files as enrich.cjs ------------------------------
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
      console.error("  No CSV found in ./output. Pass a file: node enrich-crawlee.js output/leads.csv");
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
  const state = loadState(stateFile);

  const parsed = parseCsv(fs.readFileSync(input, "utf8"));
  if (!parsed.length) {
    console.error("  Empty CSV.");
    process.exit(1);
  }
  const headers = parsed[0];
  const webCol = headers.includes("website") ? "website" : headers.find((h) => /web|url|site/i.test(h)) || "website";
  const rows = parsed.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });

  console.log(`\n  Engine: crawlee (CheerioCrawler + PlaywrightCrawler scroll fallback)`);
  console.log(`  Input : ${input}`);
  console.log(`  Output: ${outFile}`);
  const capturedAlready = [...state.values()].filter((r) => r && r.email).length;
  console.log(
    `  Resume: ${state.size ? `${capturedAlready} with email kept, re-trying the rest (use --force to redo all)` : "fresh run"}`
  );
  console.log(
    `  Mode  : HTTP concurrency ${CONCURRENCY}, scroll fallback ${USE_BROWSER ? `on (max ${BROWSER_MAX} tabs, ${SCROLL_SECS}s scroll)` : "off"}\n`
  );

  // Rebuild the enriched CSV from input rows + state map (rows in scrape order).
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

  function persist(key, website, result) {
    state.set(key, result);
    fs.appendFileSync(stateFile, JSON.stringify({ ts: new Date().toISOString(), key, website, result }) + "\n", "utf8");
  }

  // Build the work list: unique sites not already captured with an email.
  const queued = new Set();
  const jobs = []; // { id, key, url, host }
  const aggById = new Map(); // id -> aggregate
  for (const row of rows) {
    const w = (row[webCol] || "").trim();
    if (!w) continue;
    const key = siteKey(w);
    if (queued.has(key)) continue;
    const prev = state.get(key);
    if (prev && prev.email) continue;
    const url = normUrl(w);
    if (!url) continue;
    queued.add(key);
    const id = jobs.length;
    jobs.push({ id, key, url, host: hostOf(url) });
    aggById.set(id, { emails: new Set(), socials: {}, contactPage: "", viaBrowser: false, error: "", fetched: false });
  }

  console.log(`  ${rows.length} rows, ${jobs.length} unique sites to crawl\n`);
  if (!jobs.length) {
    flushCsv();
    console.log("  Nothing to do (all sites already enriched).\n");
    process.exit(0);
  }

  let processed = 0;
  let withEmail = 0;
  const hasEmail = (agg) => [...agg.emails].some((e) => agg.host && e.endsWith("@" + agg.host)) || agg.emails.size > 0;

  // ---- Pass 1: CheerioCrawler (plain HTTP) -----------------------------------
  const cheerioCrawler = new CheerioCrawler({
    maxConcurrency: CONCURRENCY,
    minConcurrency: Math.min(10, CONCURRENCY),
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: Math.ceil(TIMEOUT / 1000) + 10,
    navigationTimeoutSecs: Math.ceil(TIMEOUT / 1000),
    ignoreSslErrors: true,
    maxSessionRotations: 2,
    additionalMimeTypes: ["text/plain"],
    preNavigationHooks: [
      async ({ request }) => {
        request.headers = {
          ...request.headers,
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        };
      },
    ],
    async requestHandler({ request, body, crawler }) {
      const { id, depth } = request.userData;
      const agg = aggById.get(id);
      const html = body.toString("utf8");
      agg.fetched = true;
      const finalUrl = request.loadedUrl || request.url;

      const found = extractEmails(html);
      for (const e of found) agg.emails.add(e);
      if (found.length && !agg.contactPage && CONTACT_WORDS.test(finalUrl)) agg.contactPage = finalUrl;
      extractSocial(html, agg.socials);

      // Already have an email on the business's own domain → don't crawl further.
      if ([...agg.emails].some((e) => agg.host && e.endsWith("@" + agg.host))) return;

      if (depth === 0) {
        const links = extractCrawlLinks(html, finalUrl).slice(0, 2);
        if (!agg.contactPage && links.length) agg.contactPage = links[0];
        if (links.length) {
          await crawler.addRequests(
            links.map((u, n) => ({ url: u, userData: { id, depth: 1 }, uniqueKey: `${id}:c${n}` }))
          );
        }
      }
    },
    failedRequestHandler({ request, error }) {
      const agg = aggById.get(request.userData.id);
      if (agg && !agg.error && !agg.fetched) {
        const raw = error?.name === "TimeoutError" ? "timeout (site too slow)" : error?.message || "fetch failed";
        agg.error = String(raw);
      }
    },
  });

  await cheerioCrawler.run(
    jobs.map((j) => ({ url: j.url, userData: { id: j.id, depth: 0 }, uniqueKey: `${j.id}:home` }))
  );

  // Finalise + persist every site that already has an email from the HTTP pass.
  const needBrowser = [];
  for (const job of jobs) {
    const agg = aggById.get(job.id);
    if (agg.emails.size || !USE_BROWSER) {
      const result = finalizeResult(agg);
      persist(job.key, job.url, result);
      processed++;
      if (result.email) withEmail++;
      console.log(`  [${processed}] ${job.key}  ->  ${result.email || result.enrichStatus}`);
    } else {
      needBrowser.push(job);
    }
  }
  flushCsv();

  // ---- Pass 2: PlaywrightCrawler — scroll-to-load fallback --------------------
  if (USE_BROWSER && needBrowser.length) {
    console.log(`\n  Scroll pass: ${needBrowser.length} sites with no email yet (Chrome, ${BROWSER_MAX} tabs)\n`);

    const byId = new Map(needBrowser.map((j) => [j.id, j]));

    // True the moment an email is visible in the DOM — lets us stop scrolling
    // immediately instead of burning the full scroll budget on every site.
    const emailVisible = (page) =>
      page
        .evaluate(
          () =>
            !!document.querySelector('a[href^="mailto:"]') ||
            /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(document.body ? document.body.innerText : "")
        )
        .catch(() => false);

    async function grabFromPage(page) {
      // Reveal lazy-loaded footers/contact blocks, but bail as soon as an email
      // appears (most small-business sites have it in the footer, reached fast).
      await playwrightUtils
        .infiniteScroll(page, {
          timeoutSecs: SCROLL_SECS,
          scrollDownAndUp: false,
          stopScrollCallback: async () => emailVisible(page),
        })
        .catch(() => {});
      return (await page.content().catch(() => "")) || "";
    }

    const browserCrawler = new PlaywrightCrawler({
      maxConcurrency: BROWSER_MAX,
      minConcurrency: BROWSER_MAX, // start at full tilt — don't wait for the autoscaler to ramp
      autoscaledPoolOptions: { desiredConcurrency: BROWSER_MAX },
      maxRequestRetries: 1,
      requestHandlerTimeoutSecs: SCROLL_SECS + 25,
      navigationTimeoutSecs: Math.ceil(TIMEOUT / 1000) + 5,
      headless: BROWSER_HEADLESS,
      launchContext: {
        launchOptions: {
          channel: "chrome",
          headless: BROWSER_HEADLESS,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
        userAgent: UA,
      },
      preNavigationHooks: [
        async ({ page }, gotoOptions) => {
          // Fire as soon as the DOM is parsed — don't wait for every last image/XHR.
          if (gotoOptions) gotoOptions.waitUntil = "domcontentloaded";
          // We only need HTML/text — drop images/media/fonts to keep tabs light.
          await page.route("**/*", (route) => {
            const t = route.request().resourceType();
            if (t === "image" || t === "media" || t === "font") return route.abort();
            return route.continue();
          });
        },
      ],
      async requestHandler({ request, page, crawler }) {
        const { id, depth } = request.userData;
        const agg = aggById.get(id);
        agg.fetched = true;
        let html = await grabFromPage(page);
        for (const e of extractEmails(html)) agg.emails.add(e);
        extractSocial(html, agg.socials);
        if (agg.emails.size) {
          agg.viaBrowser = true;
          return;
        }
        // No email on the homepage DOM → follow the first contact-ish link once.
        if (depth === 0) {
          const links = extractCrawlLinks(html, page.url());
          if (links[0]) {
            if (!agg.contactPage) agg.contactPage = links[0];
            await crawler.addRequests([{ url: links[0], userData: { id, depth: 1 }, uniqueKey: `${id}:bc` }]);
          }
        }
      },
      failedRequestHandler({ request, error }) {
        const agg = aggById.get(request.userData.id);
        if (agg && !agg.error) agg.error = "browser: " + (error?.message || "failed");
      },
    });

    await browserCrawler.run(
      needBrowser.map((j) => ({ url: j.url, userData: { id: j.id, depth: 0 }, uniqueKey: `${j.id}:bhome` }))
    );
    await browserCrawler.teardown().catch(() => {});

    for (const job of byId.values()) {
      const agg = aggById.get(job.id);
      if (agg.emails.size) agg.viaBrowser = true;
      const result = finalizeResult(agg);
      persist(job.key, job.url, result);
      processed++;
      if (result.email) withEmail++;
      console.log(`  [${processed}] ${job.key}  ->  ${result.email || result.enrichStatus}`);
    }
  }

  flushCsv();
  console.log(`\n  Done. ${processed} sites crawled this run, ${withEmail} with email.`);
  console.log(`  Enriched CSV: ${outFile}\n`);
  process.exit(0);
})().catch((err) => {
  console.error("\n  Error:", err.stack || err.message);
  process.exit(1);
});
