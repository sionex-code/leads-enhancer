#!/usr/bin/env node
// Fast Google Maps lead scraper (patchright / stealth Chrome).
// Usage:
//   node scrape.js "real estate agency miami"
//   node scrape.js "https://www.google.com/maps/search/real+estate+agency+miami"
//   node scrape.js "dentists in austin" --max 100 --headless
//
// Output: ./output/<slug>-<timestamp>.csv  (rows in scrape order: first captured = top row)

const fs = require("fs");
const path = require("path");
const { chromium } = require("patchright");
const { startCapture } = require("./inpage");

// ---- CLI args ----------------------------------------------------------------
// Flags that take a value (so the value isn't mistaken for a positional query word).
const VALUE_FLAGS = new Set([
  "--max",
  "--clickDelay",
  "--closeDelay",
  "--scrollDelay",
  "--scrollAmount",
  "--maxNoCardRounds",
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

// ---- main --------------------------------------------------------------------
(async () => {
  const url = buildUrl(query);
  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(outDir, `${slugify(query)}-${stamp}.csv`);

  // Persistent profile keeps Google "warm" (cookies/consent) across runs -> faster, less friction.
  const userDataDir = path.join(__dirname, ".chrome-profile");

  console.log(`\n  Query : ${query}`);
  console.log(`  URL   : ${url}`);
  console.log(`  Output: ${outFile}`);
  console.log(`  Max   : ${maxLeads || "unlimited"}\n`);

  // Spec config: real Chrome channel, no fingerprint injection, no custom UA/headers.
  // --start-maximized + viewport:null => full-size window so the results feed AND the
  // side panel stay visible together (clicking a result then opens the panel in place
  // instead of navigating to the place-only page and losing the list).
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless,
    viewport: null,
    args: ["--start-maximized"],
  });

  const page = context.pages()[0] || (await context.newPage());

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
      // Fetch ONLY the new leads since last poll (cheap, constant-ish payload)
      // instead of re-serializing the whole growing array every tick.
      state = await page.evaluate(
        (from) => ({
          fresh: (window.__mapsLeads || []).slice(from),
          done: !!window.__MAPS_DONE,
          reason: window.__MAPS_EXIT_REASON || "",
        }),
        written
      );
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
    .evaluate((from) => (window.__mapsLeads || []).slice(from), written)
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
