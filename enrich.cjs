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
const proxy = require("./web/lib/proxy.cjs");
let PROXY_URLS = []; // admin proxy pool, loaded at startup; random per request

// ---- CLI args ----------------------------------------------------------------
const VALUE_FLAGS = new Set(["--concurrency", "--maxPages", "--timeout", "--browserConcurrency", "--siteTimeout"]);
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
// Hard ceiling for ONE site end-to-end (all pages + browser fallback). Without
// this a single hung site keeps the whole run alive indefinitely.
const SITE_TIMEOUT = parseInt(flagValue("--siteTimeout", "120000"), 10);
const WATCH = flags.has("--watch"); // keep following the CSV while the scraper appends
const FORCE = flags.has("--force"); // ignore saved state, re-enrich everything
const USE_BROWSER = !flags.has("--noBrowser"); // fall back to a real Chrome for JS sites
const BROWSER_MAX = parseInt(flagValue("--browserConcurrency", "3"), 10); // parallel Chrome tabs
// Some sites (e.g. headless-detecting Angular builds) serve a stripped page to
// headless Chrome and only render the real footer/contact email to a headed
// browser. So default to HEADED on Windows desktops, where a display exists, and
// stay headless on servers (the Linux VPS runs under xvfb or truly headless).
// Override either way with --headful / --headless.
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
  // Only handle/channel forms for YouTube (not /watch, /embed, /results).
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
async function fetchOnce(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const dispatcher = proxy.proxyDispatcher(proxy.pickRandom(PROXY_URLS));
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      ...(dispatcher ? { dispatcher } : {}),
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

async function fetchHtml(url) {
  try {
    return await fetchOnce(url, TIMEOUT);
  } catch (err) {
    // A slow site shouldn't be written off on the first timeout — retry the
    // homepage once with a longer budget. Many small-business sites are just
    // slow on a cold cache and answer fine on the second try.
    if (err.name === "AbortError") {
      return await fetchOnce(url, Math.min(TIMEOUT * 2, 30000));
    }
    throw err;
  }
}

// ---- headless browser fallback (patchright) ---------------------------------------
// Plain HTTP misses emails on JS-rendered sites (Wix/Squarespace/React) and sites
// that block non-browser requests. When that happens we render the page in real
// headless Chrome and read the emails/socials off the live DOM. The browser is
// launched lazily (only if a site actually needs it) and shared across the run.
let _browser = null;
let _ctxPromise = null;
let _browserPages = 0;

async function getBrowserContext() {
  // Reuse the live context, but self-heal if the browser died (crash/OOM). Without
  // this, a dead browser leaves _ctxPromise cached forever and every later enrich
  // fails — the long-running-server failure mode behind "enrichment has an issue".
  if (_ctxPromise && _browser && _browser.isConnected()) return _ctxPromise;
  if (_browser && !_browser.isConnected()) {
    _browser = null;
    _ctxPromise = null;
  }
  if (_ctxPromise) return _ctxPromise;
  _ctxPromise = (async () => {
    const { chromium } = require("patchright");
    // One proxy per browser launch (browsers can't rotate per-request).
    const pwProxy = await proxy.randomPlaywrightProxy();
    _browser = await chromium.launch({
      channel: "chrome",
      headless: BROWSER_HEADLESS,
      args: ["--no-sandbox", "--disable-dev-shm-usage"], // robust on the Linux VPS
      ...(pwProxy ? { proxy: pwProxy } : {}),
    });
    // If Chrome dies, drop the cached handles so the next call relaunches cleanly.
    _browser.on("disconnected", () => {
      _browser = null;
      _ctxPromise = null;
    });
    const ctx = await _browser.newContext({ userAgent: UA });
    // Block images/media/fonts — we only need the HTML/text, and this keeps tabs light.
    await ctx.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });
    return ctx;
  })().catch((err) => {
    // Failed launch must not poison the cache — clear so a retry can relaunch.
    _browser = null;
    _ctxPromise = null;
    throw err;
  });
  return _ctxPromise;
}

async function closeBrowser() {
  if (_browser) {
    try {
      await _browser.close();
    } catch {}
  }
  _browser = null;
  _ctxPromise = null;
}

// Small semaphore so we never open more than BROWSER_MAX Chrome tabs at once
// (each tab is heavy; this keeps memory bounded regardless of --concurrency).
async function withBrowserSlot(fn) {
  const waitStart = Date.now();
  while (_browserPages >= BROWSER_MAX) {
    if (Date.now() - waitStart > 120000) throw new Error("browser slots busy (waited 120s)");
    await new Promise((r) => setTimeout(r, 150));
  }
  _browserPages++;
  try {
    return await fn();
  } finally {
    _browserPages--;
  }
}

// Many sites lazy-load the footer/contact block (where the email lives) only
// once it scrolls into view. Walk down the page so those IntersectionObserver
// sections render before we read the DOM.
async function autoScroll(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0;
        const started = Date.now();
        const timer = setInterval(() => {
          window.scrollBy(0, 600);
          y += 600;
          // Deadline matters: on infinite-scroll pages scrollHeight grows as we
          // scroll, so "reached the bottom" alone may never become true and this
          // promise would hang the evaluate (and the whole run) forever.
          if (y >= document.body.scrollHeight || Date.now() - started > 10000) {
            clearInterval(timer);
            resolve();
          }
        }, 120);
      });
      window.scrollTo(0, document.body.scrollHeight);
    });
    // The revealed footer/contact block often loads its content asynchronously
    // (IntersectionObserver -> render/XHR), so a fixed short wait misses it. Wait
    // for the network to go idle, then a small settle, capped so slow sites don't
    // stall the whole run.
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  } catch {}
}

// Render homepage (and one contact-ish page if needed) in real Chrome and pull
// emails/socials from the live DOM. Returns the emails found.
const BROWSER_SITE_BUDGET = 45000; // hard cap on one site's whole browser session

async function browserEmails(website, result) {
  return withBrowserSlot(async () => {
    const ctx = await getBrowserContext();
    const page = await ctx.newPage();
    const emails = new Set();
    const work = (async () => {
      await page.goto(website, { waitUntil: "domcontentloaded", timeout: TIMEOUT }).catch(() => {});
      await page.waitForTimeout(900); // let client-side JS paint the first view
      await autoScroll(page); // reveal lazy-loaded footer/contact block
      let html = (await page.content().catch(() => "")) || "";
      for (const e of extractEmails(html)) emails.add(e);
      extractSocial(html, result);

      // No email on the homepage DOM? follow the first contact-ish link and try there.
      if (!emails.size) {
        const links = extractCrawlLinks(html, page.url());
        if (links[0]) {
          if (!result.contactPage) result.contactPage = links[0];
          await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: TIMEOUT }).catch(() => {});
          await page.waitForTimeout(700);
          await autoScroll(page);
          html = (await page.content().catch(() => "")) || "";
          for (const e of extractEmails(html)) emails.add(e);
          extractSocial(html, result);
        }
      }
    })();
    let budget;
    const deadline = new Promise((_, reject) => {
      budget = setTimeout(() => reject(new Error("browser budget exceeded (45s)")), BROWSER_SITE_BUDGET);
    });
    try {
      await Promise.race([work, deadline]);
    } finally {
      clearTimeout(budget);
      // Closing the page force-rejects any still-pending evaluate/goto, so `work`
      // settles and the browser slot is released even when the page was hung.
      await page.close().catch(() => {});
      work.catch(() => {});
    }
    return [...emails];
  });
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
    youtube: "",
    tiktok: "",
    pinterest: "",
    whatsapp: "",
    telegram: "",
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
      if (!firstError) {
        // Translate the raw error into something a non-engineer can read.
        // "AbortError" just means our request timed out waiting for the site.
        const raw = err.cause?.code || err.name || err.message || "fetch failed";
        firstError = raw === "AbortError" ? "timeout (site too slow)" : String(raw);
      }
    }
  }

  // Fallback: plain HTTP found nothing usable — render the site in headless Chrome.
  // This is what captures emails on JS-built sites and ones that block plain fetch.
  let viaBrowser = false;
  if (!emails.size && USE_BROWSER) {
    try {
      const found = await browserEmails(website, result);
      for (const e of found) emails.add(e);
      if (found.length) viaBrowser = true;
    } catch (err) {
      if (!firstError) firstError = "browser: " + (err.cause?.code || err.name || err.message || "failed");
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
    ? `ok (${list.length} email${list.length > 1 ? "s" : ""}${viaBrowser ? ", via browser" : ""})`
    : firstError
      ? `error: ${firstError}`.slice(0, 90)
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

// Race a promise against a hard deadline. The loser keeps running in the
// background but its result is ignored; per-stage budgets inside it make sure
// it settles eventually instead of pinning a browser slot.
function withTimeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} (gave up after ${Math.round(ms / 1000)}s)`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timer);
    promise.catch(() => {});
  });
}

const siteKey = (website) => {
  const h = hostOf(website);
  return h || website.trim().toLowerCase();
};

// ---- reusable export ---------------------------------------------------------
// enrichSite(website) -> { email, allEmails, contactPage, socials..., enrichStatus }
// is also driven by the web app for on-demand single-lead enrichment. Only run
// the CLI batch pipeline below when this file is executed directly.
module.exports = { enrichSite, closeBrowser };

// ---- main -----------------------------------------------------------------------------
if (require.main === module)
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
  const capturedAlready = [...state.values()].filter((r) => r && r.email).length;
  console.log(
    `  Resume: ${state.size ? `${capturedAlready} with email kept, re-trying the rest (use --force to redo all)` : "fresh run"}`
  );
  PROXY_URLS = await proxy.loadProxyUrls();
  console.log(`  Proxies: ${PROXY_URLS.length ? `${PROXY_URLS.length} (random per request)` : "none (direct)"}`);
  console.log(
    `  Mode  : concurrency ${CONCURRENCY}, ${MAX_PAGES} pages/site, ${TIMEOUT}ms timeout, browser fallback ${USE_BROWSER ? `on (max ${BROWSER_MAX} tabs)` : "off"}${WATCH ? ", WATCH" : ""}\n`
  );

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
      if (queued.has(key)) continue; // already handled this run
      const prev = state.get(key);
      // Keep sites we already captured an email for; RE-ATTEMPT everything else
      // (timeouts / "no email found"). This is why clicking Enrich again now
      // retries the failures — with the headless-browser fallback this time —
      // instead of immediately reporting "done". `queued` stops re-loops within
      // a single run, so it only re-tries on a fresh invocation.
      if (prev && prev.email) continue;
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
        result = await withTimeout(enrichSite(job.website), SITE_TIMEOUT, "site timeout");
      } catch (err) {
        result = { ...EXTRA_HEADERS.reduce((o, h) => ((o[h] = ""), o), {}), enrichStatus: "error: " + err.message };
      }
      state.set(job.key, result);
      fs.appendFileSync(
        stateFile,
        JSON.stringify({ ts: new Date().toISOString(), key: job.key, website: job.website, result }) + "\n",
        "utf8"
      );
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
  await closeBrowser();
  console.log(`\n  Done. ${processed} sites crawled this run, ${withEmail} with email.`);
  console.log(`  Enriched CSV: ${outFile}\n`);
  // A timed-out site can leave a zombie fetch/Chrome handle behind; everything is
  // flushed to disk above, so exit explicitly instead of waiting on stray handles.
  process.exit(0);
})().catch(async (err) => {
  await closeBrowser();
  console.error("\n  Error:", err.message);
  process.exit(1);
});
