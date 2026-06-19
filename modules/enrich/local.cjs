// Email-enrichment module — LOCAL backend. Wraps the existing enrich.cjs engine
// and the project-aware batch stage that used to live inline in web-runner.cjs.
const fs = require("fs");
const path = require("path");
const enrichCjs = require("../../enrich.cjs");
const { runProcess, runNodeStage } = require("../shared/spawn.cjs");
const browserPool = require("../../web/lib/browser-pool.cjs");

// Per-lead, request/response enrichment (same engine the batch uses).
function enrichSite(website) {
  return enrichCjs.enrichSite(website);
}

// ---- owner-reply detection (Phase 5) --------------------------------------------
// Reuses the shared browser-pool (web/lib/browser-pool.cjs) — the same Chrome
// instance used by the chatbot scan and single-lead enrich routes. We must NOT
// close it (pool owns the lifecycle); just borrow via withBrowser().
//
// Logic mirrors warehouse-enrich-reviews.cjs but adapted for the pool API:
//   - warm-up: one Maps navigation per run (not per lead) to avoid cold-start
//     timeouts on the first real lead; we track this with a module-level flag.
//   - per-lead: open the place URL, click the reviews button, scroll a little,
//     count "Response from the owner" occurrences among the newest ~12 reviews.
//   - early exit: once at least one reply is found we stop scrolling.
//   - budget: 30s per lead; errors leave the fields blank/undefined (never fatal).

const OWNER_REPLY_SAMPLE = 12; // how many reviews to sample for the reply signal
const OWNER_REPLY_BUDGET_MS = 30000; // per-lead hard cap
const OWNER_REPLY_ENV_OFF = process.env.OWNER_REPLY === "0"; // escape hatch

let _warmDone = false; // warm-up runs once per process

async function warmUpBrowser(context) {
  if (_warmDone) return;
  _warmDone = true; // set early so concurrent callers skip even if warm-up fails
  try {
    const page = await context.newPage();
    await page.goto("https://www.google.com/maps?hl=en&gl=us", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 2500));
    await page.close().catch(() => {});
  } catch {
    // warm-up failure is non-fatal; real leads will just be a bit slower
  }
}

// Open one Google Maps place URL, open its reviews, count owner replies among the
// newest OWNER_REPLY_SAMPLE reviews. Returns { owner_replied, owner_reply_count }
// on success; returns {} on failure (so the CSV columns stay blank).
async function checkOwnerReply(placeUrl) {
  return browserPool.withBrowser(async (browser) => {
    // create our own context so we can add cookies + block heavy assets
    const context = await browser.newContext({
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    await context.addCookies([
      { name: "CONSENT", value: "YES+cb", domain: ".google.com", path: "/" },
      {
        name: "SOCS",
        value:
          "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA4X3AwGgJlbiADGgYIgL6KqAY",
        domain: ".google.com",
        path: "/",
      },
    ]);

    await warmUpBrowser(context);

    const page = await context.newPage();
    // block heavy assets for speed
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });

    try {
      // Navigate to the place URL (append locale params)
      const url =
        placeUrl + (placeUrl.includes("?") ? "&" : "?") + "hl=en&gl=us";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        } catch { /* nav timeout — keep reading what rendered */ }
        try {
          await page.waitForFunction(
            () =>
              document.querySelector("h1") ||
              Array.from(document.querySelectorAll('button,[role="button"]')).some(
                (b) =>
                  /\breviews?\b/i.test(
                    b.getAttribute("aria-label") || b.textContent || ""
                  )
              ),
            { timeout: 18000 }
          );
          break; // panel rendered
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      // Click the reviews summary button to open the reviews list
      const opened = await page.evaluate(() => {
        const all = Array.from(
          document.querySelectorAll('button,[role="button"]')
        );
        const b = all.find((x) => {
          const t = (x.getAttribute("aria-label") || x.textContent || "").trim();
          return (
            /^[\d.,]+\s*stars?\b/i.test(t) || /^[\d,]+\s*reviews?$/i.test(t)
          );
        });
        if (b) { b.click(); return true; }
        return false;
      });

      if (!opened) {
        // No review button → check if reviews are already rendered
        const anyReview = await page.$("[data-review-id]");
        if (!anyReview) {
          await context.close().catch(() => {});
          return {}; // no reviews at all
        }
      }
      await new Promise((r) => setTimeout(r, 2000));

      // Scroll the reviews list, sampling until we have OWNER_REPLY_SAMPLE reviews
      // or find an owner reply (early exit).
      const probe = () =>
        page.evaluate(() => ({
          n: document.querySelectorAll("[data-review-id]").length,
          owner: (
            (document.body.innerText || "").match(
              /Response from the owner/gi
            ) || []
          ).length,
        }));

      let last = await probe();
      for (let i = 0; i < 6; i++) {
        if (last.owner > 0 || last.n >= OWNER_REPLY_SAMPLE) break;
        await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("div")).filter(
            (d) => d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 150
          );
          els.sort((a, b) => b.scrollHeight - a.scrollHeight);
          if (els[0]) els[0].scrollBy(0, 3000);
        });
        await new Promise((r) => setTimeout(r, 900));
        const now = await probe();
        if (now.n === last.n && i > 1) { last = now; break; } // no more loading
        last = now;
      }

      await context.close().catch(() => {});
      return {
        owner_replied: last.owner > 0 ? 1 : 0,
        owner_reply_count: last.owner,
      };
    } catch (err) {
      await context.close().catch(() => {});
      return {}; // non-fatal: leave columns blank
    } finally {
      await page.close().catch(() => {});
    }
  });
}

// Run the owner-reply pass over the enriched CSV produced by the email-enrich
// subprocess. Reads the enriched CSV, writes owner_replied + owner_reply_count
// into each row that has a mapsUrl, then re-writes the CSV in-place.
//
// This runs AFTER the email-enrich subprocess so it sees the final enriched file.
// Gate: skipped when --no-owner-reply flag is set OR OWNER_REPLY=0 env is set.
async function runOwnerReplyPass(ctx, enrichedCsvPath) {
  if (!enrichedCsvPath || !fs.existsSync(enrichedCsvPath)) return;

  // opt-out flags
  if (
    OWNER_REPLY_ENV_OFF ||
    ctx.flags.has("--no-owner-reply")
  ) {
    ctx.log("owner-reply pass: skipped (--no-owner-reply / OWNER_REPLY=0)");
    return;
  }

  // Parse the enriched CSV
  const raw = fs.readFileSync(enrichedCsvPath, "utf8");
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const text = hasBom ? raw.slice(1) : raw;

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return; // empty or header-only

  const headerLine = lines[0];
  const headers = parseCsvRow(headerLine);
  const mapsColIdx = headers.indexOf("mapsUrl");
  const orIdx = headers.indexOf("owner_replied");
  const orcIdx = headers.indexOf("owner_reply_count");

  if (mapsColIdx === -1) {
    ctx.log("owner-reply pass: no mapsUrl column in enriched CSV — skipped");
    return;
  }
  // Ensure output columns exist in headers; if not, add them
  const outHeaders = [...headers];
  let ownerRepliedIdx = orIdx;
  let ownerReplyCountIdx = orcIdx;
  if (ownerRepliedIdx === -1) {
    outHeaders.push("owner_replied");
    ownerRepliedIdx = outHeaders.length - 1;
  }
  if (ownerReplyCountIdx === -1) {
    outHeaders.push("owner_reply_count");
    ownerReplyCountIdx = outHeaders.length - 1;
  }

  // Parse all data rows into arrays
  const dataRows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => parseCsvRow(l));

  const total = dataRows.filter((r) => (r[mapsColIdx] || "").trim()).length;
  ctx.log(`owner-reply pass: ${total} leads with mapsUrl to check`);
  if (!total) return;

  let done = 0;
  let replied = 0;
  for (const row of dataRows) {
    const mapsUrl = (row[mapsColIdx] || "").trim();
    if (!mapsUrl) continue;

    // extend row to match outHeaders length if new columns were appended
    while (row.length < outHeaders.length) row.push("");

    let result = {};
    try {
      const deadline = new Promise((_, rej) =>
        setTimeout(() => rej(new Error("owner-reply timeout")), OWNER_REPLY_BUDGET_MS)
      );
      result = await Promise.race([checkOwnerReply(mapsUrl), deadline]);
    } catch (err) {
      ctx.log(`owner-reply: [skip] ${mapsUrl.slice(0, 60)} — ${err.message}`);
    }

    if (result.owner_replied !== undefined) {
      row[ownerRepliedIdx] = String(result.owner_replied);
      row[ownerReplyCountIdx] = String(result.owner_reply_count);
      done++;
      if (result.owner_replied) replied++;
      ctx.log(
        `owner-reply: [${done}/${total}] replied=${result.owner_replied} count=${result.owner_reply_count}`
      );
    }
  }

  // Re-write the enriched CSV (preserve BOM if original had one)
  const bom = hasBom ? "﻿" : "";
  const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const outLines = [
    outHeaders.join(","),
    ...dataRows.map((r) => r.map((_, i) => csvEsc(r[i] ?? "")).join(",")),
  ];
  fs.writeFileSync(enrichedCsvPath, bom + outLines.join("\r\n") + "\r\n", "utf8");
  ctx.log(`owner-reply pass done: ${done} checked, ${replied} replied to reviews`);
}

// Minimal single-line CSV row parser (handles quoted fields with embedded commas).
function parseCsvRow(line) {
  const fields = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { fields.push(field); field = ""; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

// Project-aware batch stage (web-runner local path). Identical behavior to the
// former web-runner.runEnrich: pick the latest raw CSV and run the chosen engine.
// After the email-enrich subprocess finishes, runs the owner-reply pass (Phase 5).
async function runBatch(ctx) {
  const input = ctx.store.latestRawCsv(ctx.dir);
  if (!input) throw new Error("No scraped CSV found to enrich");
  const engine = ctx.value("--enrichEngine", "patchright").toLowerCase();
  if (engine === "crawlee") {
    const concurrency = ctx.value("--enrichConcurrency", "30");
    const args = [input, "--concurrency", concurrency, "--timeout", "15000"];
    await runNodeStage(ctx, "enrich", "enrich-crawlee.js", path.join(ctx.dir, "enrich.log"), args);
    // owner-reply pass after crawlee enrich
    await runOwnerReplyPass(ctx, ctx.store.latestEnrichedCsv(ctx.dir));
    return;
  }
  const concurrency = ctx.value("--enrichConcurrency", "16");
  // 15s timeout (plus the in-enricher retry) is forgiving of slow small-biz sites.
  const args = [input, "--concurrency", concurrency, "--maxPages", "4", "--timeout", "15000"];
  await runNodeStage(ctx, "enrich", "enrich.js", path.join(ctx.dir, "enrich.log"), args);
  // Phase 5: owner-reply pass — open each lead's Maps page, count owner replies.
  // Gate: skip with --no-owner-reply flag or OWNER_REPLY=0 env var.
  await runOwnerReplyPass(ctx, ctx.store.latestEnrichedCsv(ctx.dir));
}

// File-level run used by the worker: enrich `inputPath`, producing
// `<base>-enriched.csv` beside it (enrich.cjs's own convention).
async function runFile({ ROOT, inputPath, params = {}, logFile }) {
  const engine = String(params.engine || "patchright").toLowerCase();
  const log = logFile || path.join(path.dirname(inputPath), "enrich.log");
  if (engine === "crawlee") {
    const concurrency = String(params.concurrency || "30");
    await runProcess("enrich", log, [path.join(ROOT, "enrich-crawlee.js"), inputPath, "--concurrency", concurrency, "--timeout", "15000"], { cwd: ROOT });
  } else {
    const concurrency = String(params.concurrency || "16");
    await runProcess("enrich", log, [path.join(ROOT, "enrich.js"), inputPath, "--concurrency", concurrency, "--maxPages", "4", "--timeout", "15000"], { cwd: ROOT });
  }
  // Note: runFile is used by the remote worker which runs out-of-process.
  // Owner-reply requires the browser-pool (in-process only); the remote worker
  // path does not support it. runBatch (in-process) handles the owner-reply pass.
}

module.exports = { enrichSite, closeBrowser: enrichCjs.closeBrowser, runBatch, runFile };
