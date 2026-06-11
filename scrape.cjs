#!/usr/bin/env node
// Fast Google Maps lead scraper (patchright / stealth Chrome).
// Usage:
//   node scrape.js "real estate agency miami"
//   node scrape.js "https://www.google.com/maps/search/real+estate+agency+miami"
//   node scrape.js "dentists in austin" --max 100 --headless
//   node scrape.js "dentists in austin" --cookies ./gmail-cookies.json
//   node scrape.js "dentists in austin" --network        # fast: read leads off the Maps RPC
//
// Output: ./output/<slug>-<timestamp>.csv  (rows in scrape order: first captured = top row)
//
// Capture modes:
//   (default) DOM   - click each result card, read the side panel. Most resilient,
//                     but ~1.7s/lead and slows as the list grows.
//   --network       - decode the "/search?tbm=map" responses (~20 detailed places
//                     per scroll, no clicking). Much faster and stays flat. Misses
//                     plusCode (not in the RPC). --dom forces the legacy path.

const fs = require("fs");
const path = require("path");
const { chromium } = require("patchright");
const { startCapture } = require("./inpage.cjs");
const { rowsFromBody } = require("./mapsparse.cjs");

// ---- CLI args ----------------------------------------------------------------
// Flags that take a value (so the value isn't mistaken for a positional query word).
const VALUE_FLAGS = new Set([
  "--max",
  "--clickDelay",
  "--closeDelay",
  "--scrollDelay",
  "--scrollAmount",
  "--maxNoCardRounds",
  "--outDir",
  "--profileDir",
  "--cookies",
  "--viewportWidth",
  "--viewportHeight",
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
      flagValues[a] = rawArgs[++i]; // consume the value
    }
  } else {
    positionals.push(a);
  }
}

function flagValue(name, fallback) {
  return flagValues[name] !== undefined ? flagValues[name] : fallback;
}

const query = positionals.join(" ").trim() || "real estate agency miami";
const maxLeads = parseInt(flagValue("--max", "0"), 10) || 0; // 0 = unlimited
const headless = flags.has("--headless");
const blockImages = !flags.has("--allowImages");
// Network mode reads leads straight off the Maps "/search?tbm=map" RPC responses
// (~20 detailed places per scroll, no per-card clicking) — much faster and it
// doesn't slow down as the result set grows. --dom forces the legacy click path.
const useNetwork = flags.has("--network") && !flags.has("--dom");
const viewportWidth = parsePositiveInt(flagValue("--viewportWidth", "1920"), 1920);
const viewportHeight = parsePositiveInt(flagValue("--viewportHeight", "1080"), 1080);

// In-page pacing. Defaults match the spec; tune via flags if needed.
const CONFIG = {
  clickDelay: parseInt(flagValue("--clickDelay", "1200"), 10),
  closeDelay: parseInt(flagValue("--closeDelay", "500"), 10),
  scrollDelay: parseInt(flagValue("--scrollDelay", "800"), 10),
  scrollAmount: parseInt(flagValue("--scrollAmount", "1000"), 10),
  maxNoCardRounds: parseInt(flagValue("--maxNoCardRounds", "12"), 10),
  maxLeads,
};

const HEADERS = [
  "name",
  "category",
  "rating",
  "reviews",
  "website",
  "websiteText",
  "phone",
  "address",
  "plusCode",
  "hours",
  "imageUrls",
  "mapsUrl",
];

// ---- helpers -----------------------------------------------------------------
function buildUrl(q) {
  if (/^https?:\/\//i.test(q)) return q;
  return "https://www.google.com/maps/search/" + encodeURIComponent(q).replace(/%20/g, "+");
}

function slugify(q) {
  return (
    q
      .replace(/^https?:\/\/[^/]+\/maps\/search\//i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "leads"
  );
}

const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
// UTF-8 BOM + header, written once. Rows are appended individually (O(1) each)
// so a long run never rebuilds the whole CSV — keeps writes fast as leads grow.
const csvHeader = () => String.fromCharCode(0xfeff) + HEADERS.join(",") + "\r\n";
const csvRow = (row) => HEADERS.map((h) => csvEsc(row[h])).join(",") + "\r\n";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadCookies(file) {
  if (!file) return [];
  const resolved = path.resolve(file);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;
  if (!Array.isArray(cookies)) {
    throw new Error(`Cookie file must contain an array or {"cookies": [...]}: ${resolved}`);
  }
  return cookies.map(normalizeCookie).filter(Boolean);
}

function normalizeCookie(cookie) {
  if (!cookie || cookie.name === undefined || cookie.value === undefined) return null;
  const normalized = {
    name: String(cookie.name),
    value: String(cookie.value),
    path: cookie.path || "/",
  };

  if (cookie.url) normalized.url = cookie.url;
  else if (cookie.domain) normalized.domain = cookie.domain;
  else normalized.url = "https://www.google.com";

  if (cookie.expires !== undefined || cookie.expirationDate !== undefined) {
    const expires = Number(cookie.expires ?? cookie.expirationDate);
    if (Number.isFinite(expires) && expires > 0) normalized.expires = Math.floor(expires);
  }
  if (cookie.httpOnly !== undefined) normalized.httpOnly = !!cookie.httpOnly;
  if (cookie.secure !== undefined) normalized.secure = !!cookie.secure;

  const sameSite = String(cookie.sameSite || "").toLowerCase().replace(/[_\s-]/g, "");
  if (sameSite === "strict") normalized.sameSite = "Strict";
  else if (sameSite === "lax") normalized.sameSite = "Lax";
  else if (sameSite === "none" || sameSite === "no_restriction" || sameSite === "norestriction") {
    normalized.sameSite = "None";
    normalized.secure = true;
  }

  return normalized;
}

// ---- main --------------------------------------------------------------------
(async () => {
  const url = buildUrl(query);
  // --outDir lets a project run drop the CSV straight into output/projects/<name>/.
  const outDir = flagValues["--outDir"]
    ? path.resolve(flagValues["--outDir"])
    : path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(outDir, `${slugify(query)}-${stamp}.csv`);

  // Persistent profile keeps Google "warm" (cookies/consent) across runs -> faster, less friction.
  // The web UI passes a per-project profile so browser cleanup never touches other automation.
  const userDataDir = flagValues["--profileDir"]
    ? path.resolve(flagValues["--profileDir"])
    : path.join(__dirname, ".chrome-profile");
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`\n  Query : ${query}`);
  console.log(`  URL   : ${url}`);
  console.log(`  Output: ${outFile}`);
  console.log(`  Max   : ${maxLeads || "unlimited"}`);
  console.log(`  View  : ${viewportWidth}x${viewportHeight} ${headless ? "headless" : "headful"}`);
  console.log(`  Images: ${blockImages ? "blocked" : "allowed"}\n`);

  // Spec config: real Chrome channel, no fingerprint injection, no custom UA/headers.
  // This matches the original (most stable) launch: a 1920x1080 viewport plus a
  // maximized window so the results feed AND the side panel stay visible together
  // (clicking a result opens the panel in place instead of navigating to the
  // place-only page and losing the list). --disable-dev-shm-usage is a no-op on
  // Windows and prevents Chrome's small /dev/shm from filling up on Linux long runs.
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless,
    viewport: { width: viewportWidth, height: viewportHeight },
    args: [
      `--window-size=${viewportWidth},${viewportHeight}`,
      "--start-maximized",
      "--disable-dev-shm-usage",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: viewportWidth, height: viewportHeight }).catch(() => {});

  if (blockImages) {
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });
  }

  const cookieFile = flagValue("--cookies", "");
  if (cookieFile) {
    const cookies = loadCookies(cookieFile);
    if (cookies.length) await context.addCookies(cookies);
    console.log(`  Cookies: loaded ${cookies.length} from ${path.resolve(cookieFile)}`);
  } else {
    console.log("  Cookies: none");
  }

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Handle Google consent screen if it appears (EU/first run).
  await dismissConsent(page);

  // Wait for the results feed to exist.
  try {
    await page.waitForSelector('div[role="feed"]', { timeout: 30000 });
  } catch {
    console.warn(
      "  Results feed not found. If a consent/login page is showing, accept it in the window, then re-run."
    );
  }

  // ---- Network capture mode --------------------------------------------------
  if (useNetwork) {
    fs.writeFileSync(outFile, csvHeader(), "utf8");
    const { written, reason } = await runNetworkCapture(page, outFile);
    console.log(`\n\n  Exit reason: ${reason || "n/a"}`);
    console.log(`  Finished. ${written} leads saved to:\n  ${outFile}\n`);
    await context.close();
    process.exit(0);
  }

  // Surface in-page progress to the terminal.
  page.on("console", (msg) => {
    const t = msg.text();
    if (/^Captured #|^Done\.|Reached end/.test(t)) console.log("   " + t);
  });

  // Inject + start the click/capture/remove loop (non-blocking), then poll progress.
  await page.evaluate(startCapture, CONFIG);

  fs.writeFileSync(outFile, csvHeader(), "utf8"); // header once

  let written = 0;
  let reason = "";
  let done = false;
  while (!done) {
    await sleep(1200);
    let state;
    try {
      // DRAIN the captured leads each tick: __drainLeads() returns the new rows
      // AND clears the in-page buffer, so the page's memory footprint stays flat
      // no matter how many thousands of leads we capture (the running total is
      // tracked separately in __MAPS_TOTAL). This is the key to the browser not
      // slowing down / ballooning on long runs.
      state = await page.evaluate(() => ({
        fresh: window.__drainLeads ? window.__drainLeads() : [],
        done: !!window.__MAPS_DONE,
        reason: window.__MAPS_EXIT_REASON || "",
      }));
    } catch {
      break; // page navigated/closed
    }

    if (state.fresh.length) {
      fs.appendFileSync(outFile, state.fresh.map(csvRow).join(""), "utf8");
      written += state.fresh.length;
      process.stdout.write(`\r  Captured ${written} leads...   `);
    }
    reason = state.reason || reason;
    done = state.done;
  }

  // Final flush of any stragglers captured between the last poll and completion.
  const tail = await page
    .evaluate(() => (window.__drainLeads ? window.__drainLeads() : []))
    .catch(() => []);
  if (tail.length) {
    fs.appendFileSync(outFile, tail.map(csvRow).join(""), "utf8");
    written += tail.length;
  }

  console.log(`\n\n  Exit reason: ${reason || "n/a"}`);
  console.log(`  Finished. ${written} leads saved to:\n  ${outFile}\n`);

  await context.close();
  process.exit(0);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});

// Read leads off the Maps search RPC. We listen for every "/search?tbm=map"
// response, decode it, and stream new (deduped) rows to the CSV — then scroll the
// feed to make Google fetch the next batch. No per-card clicking, so throughput
// stays flat instead of degrading as the result set grows.
async function runNetworkCapture(page, outFile) {
  const seen = new Set(); // place key (cid/place id) -> dedup across batches
  let pending = []; // rows decoded but not yet flushed to CSV
  let decodeErrors = 0;

  page.on("response", async (res) => {
    const u = res.url();
    if (!/\/search\?tbm=map/.test(u)) return;
    let body;
    try {
      body = await res.text();
    } catch {
      return; // response body already gone (navigation)
    }
    let parsed;
    try {
      parsed = rowsFromBody(body);
    } catch {
      decodeErrors++;
      return;
    }
    for (let i = 0; i < parsed.rows.length; i++) {
      const key = parsed.keys[i] || parsed.rows[i].name;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      pending.push(parsed.rows[i]);
    }
  });

  // Scroll the feed to its bottom so Google's lazy-loader fetches the next batch.
  // A fixed scrollBy() stalls once the feed is tall: small increments land inside
  // already-loaded content and never reach the sentinel that triggers the next
  // RPC. Jumping to the bottom AND nudging the last card into view reliably pulls
  // the next page. Returns scrollHeight so the caller can tell whether the list is
  // still actually growing (vs. a round where every place was a dedup).
  const scrollFeed = () =>
    page
      .evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (!feed) return { ok: false, height: 0 };
        feed.scrollTop = feed.scrollHeight;
        const cards = feed.querySelectorAll('div[role="article"]');
        const last = cards[cards.length - 1];
        if (last) last.scrollIntoView({ block: "end" });
        return { ok: true, height: feed.scrollHeight };
      })
      .catch(() => ({ ok: false, height: 0 }));

  // Re-arm a stalled lazy-loader: scroll up a couple screens, then the next loop
  // iteration snaps back to the bottom. The jump (rather than sitting pinned at
  // the bottom) is what makes Google's IntersectionObserver fire another fetch.
  const jiggleFeed = () =>
    page
      .evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight * 2);
      })
      .catch(() => {});

  const feedHasEnd = () =>
    page
      .evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        return !!feed && feed.textContent.includes("You've reached the end of the list");
      })
      .catch(() => false);

  let written = 0;
  const cap = CONFIG.maxLeads || Infinity;
  const flush = () => {
    if (!pending.length) return 0;
    const room = cap - written;
    if (room <= 0) return 0;
    const batch = pending.splice(0, Math.min(pending.length, room));
    fs.appendFileSync(outFile, batch.map(csvRow).join(""), "utf8");
    return batch.length;
  };

  // The first batch arrives with the page load; give it a moment to land.
  await sleep(1500);
  written += flush();
  if (written) process.stdout.write(`\r  Captured ${written} leads...   `);

  let reason = "completed";
  let noGrowthRounds = 0;
  // Be generous before declaring the list exhausted: Google often pauses for a
  // beat between batches, and a stalled loader usually restarts after a jiggle.
  const MAX_NO_GROWTH = Math.max(CONFIG.maxNoCardRounds, 15);
  let lastHeight = 0;

  while (true) {
    if (CONFIG.maxLeads && written >= CONFIG.maxLeads) {
      reason = "max leads reached";
      break;
    }
    const { ok, height } = await scrollFeed();
    if (!ok) {
      reason = "results feed gone";
      break;
    }
    await sleep(CONFIG.scrollDelay + 700); // let the next RPC batch arrive + decode

    const added = flush();
    // The feed getting taller means Google rendered more cards — progress, even if
    // this round's RPC places were all dedups. Only count a round as "dead" when
    // nothing was written AND the feed didn't grow.
    const grew = height > lastHeight + 4;
    if (height > lastHeight) lastHeight = height;

    if (added) {
      written += added;
      process.stdout.write(`\r  Captured ${written} leads...   `);
      noGrowthRounds = 0;
    } else if (grew) {
      noGrowthRounds = 0;
    } else {
      noGrowthRounds++;
      await jiggleFeed(); // re-arm the lazy-loader before the next scroll-to-bottom
      await sleep(400);
    }

    if (await feedHasEnd()) {
      written += flush();
      reason = "reached end of list";
      break;
    }
    if (noGrowthRounds >= MAX_NO_GROWTH) {
      reason = "no new leads after scrolling";
      break;
    }
  }

  written += flush(); // final stragglers
  if (CONFIG.maxLeads && written > CONFIG.maxLeads) written = CONFIG.maxLeads; // report cap honestly
  return { written, reason };
}

async function dismissConsent(page) {
  const tryClick = async (frame) => {
    const selectors = [
      'button[aria-label="Accept all"]',
      'button[aria-label="Reject all"]',
      'form[action*="consent"] button',
      'button:has-text("Accept all")',
      'button:has-text("Reject all")',
      'button:has-text("I agree")',
    ];
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el) {
          await el.click({ timeout: 3000 });
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          return true;
        }
      } catch {}
    }
    return false;
  };

  if (await tryClick(page)) return;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (await tryClick(frame)) return;
  }
}
