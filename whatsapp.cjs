#!/usr/bin/env node
// WhatsApp checker: for every lead in a CSV, normalizes the phone number and
// asks the OpenWA API whether that number is registered on WhatsApp. Writes a
// new CSV next to the input with whatsapp columns added.
//
// Usage:
//   node whatsapp.js                                 # latest CSV in ./output (enriched preferred)
//   node whatsapp.js output/leads-enriched.csv       # specific file
//   node whatsapp.js output/leads.csv --concurrency 4
//   node whatsapp.js --watch                          # follow a CSV still being written
//
// API config (flags override env override built-in defaults):
//   --apiUrl     OWA_API_URL      base url, e.g. http://144.91.104.65:26768
//   --sessionId  OWA_SESSION_ID   OpenWA session id
//   --apiKey     OWA_API_KEY      X-API-Key value
//
// Endpoint used (per OpenWA spec):
//   GET {apiUrl}/api/sessions/{sessionId}/contacts/check/{number}
//   -> { "number": "...", "exists": true|false, "whatsappId": "...@c.us"|null }
//
// Resume: progress is appended to <input>.whatsapp-state.jsonl after every number.
// Re-running skips numbers already checked (use --force to redo).

const fs = require("fs");
const path = require("path");

// ---- CLI args ----------------------------------------------------------------
const VALUE_FLAGS = new Set(["--concurrency", "--timeout", "--apiUrl", "--sessionId", "--apiKey", "--region", "--retries", "--minGap"]);
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

const CONCURRENCY = Math.max(1, parseInt(flagValue("--concurrency", "2"), 10));
const TIMEOUT = parseInt(flagValue("--timeout", "15000"), 10); // per API request, ms
const MAX_RETRIES = Math.max(0, parseInt(flagValue("--retries", "5"), 10)); // on 429/5xx
const MIN_GAP = Math.max(0, parseInt(flagValue("--minGap", "120"), 10)); // ms between API calls (global)
const WATCH = flags.has("--watch");
const FORCE = flags.has("--force");
const INPLACE = flags.has("--inplace"); // write columns back into the input CSV (pipeline use)

// OpenWA connection — defaults are the user's working instance; override with
// flags or env vars in other deployments. The api key is read from env first so
// it never has to be hard-committed when callers prefer that.
const API_URL = (flagValue("--apiUrl", process.env.OWA_API_URL || "http://144.91.104.65:26768") || "").replace(/\/+$/, "");
const SESSION_ID = flagValue("--sessionId", process.env.OWA_SESSION_ID || "5386fbba-0153-4db2-919b-4c9193d34d50");
const API_KEY = flagValue("--apiKey", process.env.OWA_API_KEY || "owa_k1_32f955671ea4e843d4827d5ea6e89b47");
// Default country code (digits only, no +) prepended to local numbers that have
// no country code of their own. Google Maps usually returns a +country number,
// so this only kicks in for the rare bare local number.
const DEFAULT_CC = (flagValue("--region", process.env.OWA_DEFAULT_CC || "") || "").replace(/\D/g, "");

const EXTRA_HEADERS = ["whatsappNumber", "whatsappExists", "whatsappId", "whatsappStatus"];

// ---- tiny CSV (shared shape with scrape.js / enrich.js) ----------------------
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

// ---- phone normalization -----------------------------------------------------
// Turn a human phone string ("+1 425-537-4728", "(0327) 866 7097", "tel:+92…")
// into the digits-only E.164-style id WhatsApp expects (country code + number,
// no leading +). Returns "" when there are no usable digits.
function normalizePhone(raw, defaultCc = DEFAULT_CC) {
  let s = String(raw || "").trim();
  if (!s) return "";
  // Some sources prefix tel:/callto:; drop anything before the first digit/plus.
  s = s.replace(/^(tel:|callto:|whatsapp:)/i, "");
  const hadPlus = /^\s*\+/.test(s) || /^\s*00/.test(s.replace(/[^\d+]/g, ""));
  let digits = s.replace(/\D/g, "");
  if (!digits) return "";
  const cc = String(defaultCc || "").replace(/\D/g, "");
  // International "00" prefix means a +country number — strip the 00.
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (!hadPlus && cc) {
    // A bare local number with a known country code: drop a leading trunk "0"
    // (e.g. UK "020…" -> "20…") then prepend the country code, unless the number
    // already starts with it (so US "1 866…" isn't doubled to "11866…").
    const local = digits.replace(/^0+/, "");
    digits = local.startsWith(cc) ? local : cc + local;
  } else if (!hadPlus && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    // No country code known (US/Canada addresses usually omit the country), but
    // this is a valid 10-digit North American number per NANP rules — default
    // its country code to 1 so the WhatsApp lookup works.
    digits = "1" + digits;
  }
  return digits;
}

// Map a (possibly German-localized) country name to its international dialing
// code, so a bare local number can be made WhatsApp-checkable when we know the
// lead's country. Returns "" for unknown names (number is left as-is).
const COUNTRY_DIAL_CODES = {
  "united states": "1", "united states of america": "1", usa: "1", us: "1",
  "vereinigte staaten": "1", "vereinigte staaten von amerika": "1",
  canada: "1", kanada: "1",
  "united kingdom": "44", uk: "44", "great britain": "44", "vereinigtes königreich": "44",
  pakistan: "92",
  india: "91", indien: "91",
  "united arab emirates": "971", uae: "971", "vereinigte arabische emirate": "971",
  qatar: "974", katar: "974",
  oman: "968",
  "saudi arabia": "966", "saudi-arabien": "966",
  germany: "49", deutschland: "49",
  france: "33", frankreich: "33",
  italy: "39", italien: "39",
  spain: "34", spanien: "34",
  netherlands: "31", niederlande: "31",
  australia: "61", australien: "61",
  ireland: "353", irland: "353",
  "new zealand": "64", neuseeland: "64",
  "south africa": "27", südafrika: "27",
  kuwait: "965", bahrain: "973",
  belgium: "32", belgien: "32",
  switzerland: "41", schweiz: "41",
  austria: "43", österreich: "43",
};
function dialingCode(country) {
  return COUNTRY_DIAL_CODES[String(country || "").trim().toLowerCase()] || "";
}

// ---- rate limiter ------------------------------------------------------------
// The OpenWA instance returns 429 if hit too fast, so we serialize the *start* of
// every request to be at least MIN_GAP apart (across all workers). Combined with
// 429 backoff below this keeps the run under the server's limit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _nextSlot = 0;
async function rateGate() {
  const now = Date.now();
  const wait = Math.max(0, _nextSlot - now);
  _nextSlot = Math.max(now, _nextSlot) + MIN_GAP;
  if (wait) await sleep(wait);
}

// ---- the actual check --------------------------------------------------------
async function checkOnce(number) {
  await rateGate();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const url = `${API_URL}/api/sessions/${encodeURIComponent(SESSION_ID)}/contacts/check/${encodeURIComponent(number)}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "X-API-Key": API_KEY, accept: "application/json" },
    });
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      const ra = parseInt(res.headers.get("retry-after") || "", 10);
      return { retry: true, retryAfter: Number.isFinite(ra) ? ra * 1000 : 0, status: `HTTP ${res.status}` };
    }
    if (!res.ok) return { result: { exists: "", whatsappId: "", status: `error: HTTP ${res.status}`.slice(0, 90) } };
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return { result: { exists: "", whatsappId: "", status: "error: bad JSON response" } };
    }
    // Be tolerant of small response-shape differences across OpenWA versions.
    const d = data && data.data ? data.data : data;
    const exists = !!(d && (d.exists ?? d.isRegistered ?? d.registered));
    const wid = (d && (d.whatsappId || d.chatId || d.jid)) || "";
    return {
      result: { exists, whatsappId: exists ? wid || `${number}@c.us` : "", status: exists ? "on whatsapp" : "not on whatsapp" },
    };
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    const raw = isTimeout ? "timeout" : err.cause?.code || err.name || err.message || "failed";
    // Network blips / timeouts are worth a retry too.
    return { retry: true, retryAfter: 0, status: `error: ${raw}`.slice(0, 90) };
  } finally {
    clearTimeout(t);
  }
}

async function checkNumber(number) {
  let lastStatus = "error: failed";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await checkOnce(number);
    if (r.result) return r.result;
    lastStatus = r.status;
    if (attempt < MAX_RETRIES) {
      // Honor Retry-After if given, else exponential backoff (0.5s,1s,2s,…) capped.
      const backoff = r.retryAfter || Math.min(500 * 2 ** attempt, 8000);
      await sleep(backoff);
    }
  }
  return { exists: "", whatsappId: "", status: `error: ${lastStatus} (gave up)`.slice(0, 90) };
}

// ---- state (resume) ----------------------------------------------------------
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

// ---- reusable export ---------------------------------------------------------
// checkNumber(number) -> { exists, whatsappId, status } and normalizePhone() are
// driven by the web app for on-demand single-lead WhatsApp checks. Only run the
// CLI batch pipeline below when this file is executed directly.
module.exports = { checkNumber, normalizePhone, dialingCode };

// ---- main --------------------------------------------------------------------
if (require.main === module)
(async () => {
  // Resolve input: explicit path, else most recent CSV in ./output (prefer enriched).
  let input = positionals[0];
  if (!input) {
    const dir = path.join(__dirname, "output");
    const csvs = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".csv") && !f.includes("-whatsapp"))
          .map((f) => path.join(dir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    input = csvs.find((f) => f.includes("-enriched")) || csvs[0];
    if (!input) {
      console.error("  No CSV found in ./output. Pass a file: node whatsapp.js output/leads.csv");
      process.exit(1);
    }
  }
  input = path.resolve(input);
  if (!fs.existsSync(input)) {
    console.error(`  File not found: ${input}`);
    process.exit(1);
  }
  if (!API_URL || !SESSION_ID || !API_KEY) {
    console.error("  Missing OpenWA config. Provide --apiUrl --sessionId --apiKey (or OWA_* env vars).");
    process.exit(1);
  }

  const outFile = INPLACE ? input : input.replace(/\.csv$/i, "-whatsapp.csv");
  const stateFile = input.replace(/\.csv$/i, ".whatsapp-state.jsonl");
  const state = loadState(stateFile); // normalized number -> result (resume across runs)

  console.log(`\n  Input  : ${input}`);
  console.log(`  Output : ${outFile}`);
  console.log(`  API    : ${API_URL}  session ${SESSION_ID.slice(0, 8)}…`);
  console.log(`  Resume : ${state.size ? `${state.size} numbers already checked (use --force to redo)` : "fresh run"}`);
  console.log(`  Mode   : concurrency ${CONCURRENCY}, ${TIMEOUT}ms timeout${WATCH ? ", WATCH" : ""}\n`);

  let headers = [];
  let rows = [];
  let phoneCol = "phone";

  function readInput() {
    const parsed = parseCsv(fs.readFileSync(input, "utf8"));
    if (!parsed.length) return 0;
    headers = parsed[0];
    phoneCol = headers.includes("phone") ? "phone" : headers.find((h) => /phone|tel|mobile|number/i.test(h)) || "phone";
    const prev = rows.length;
    rows = parsed.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
      return obj;
    });
    return rows.length - prev;
  }

  // Rebuild the output CSV from input rows + state map, in input order.
  function flushCsv() {
    const outHeaders = [...headers, ...EXTRA_HEADERS.filter((h) => !headers.includes(h))];
    const lines = [String.fromCharCode(0xfeff) + outHeaders.join(",") + "\r\n"];
    for (const row of rows) {
      const num = normalizePhone(row[phoneCol]);
      let merged = { ...row };
      if (!num) {
        merged.whatsappNumber = "";
        merged.whatsappExists = "";
        merged.whatsappId = "";
        merged.whatsappStatus = "no phone";
      } else {
        const res = state.get(num);
        merged.whatsappNumber = num;
        merged.whatsappExists = res ? (res.exists === "" ? "" : res.exists ? "yes" : "no") : "";
        merged.whatsappId = res ? res.whatsappId : "";
        merged.whatsappStatus = res ? res.status : "pending";
      }
      lines.push(outHeaders.map((h) => csvEsc(merged[h])).join(",") + "\r\n");
    }
    fs.writeFileSync(outFile, lines.join(""), "utf8");
  }

  readInput();

  // Work queue of unique normalized numbers not yet in state.
  const queued = new Set();
  const queue = [];
  function enqueueNew() {
    for (const row of rows) {
      const num = normalizePhone(row[phoneCol]);
      if (!num || queued.has(num)) continue;
      if (state.has(num)) continue;
      queued.add(num);
      queue.push(num);
    }
  }
  enqueueNew();
  const totalRowsWithPhone = rows.filter((r) => normalizePhone(r[phoneCol])).length;
  console.log(`  ${rows.length} rows, ${totalRowsWithPhone} with a phone, ${queue.length} unique numbers to check\n`);

  let processed = 0;
  let onWa = 0;

  async function worker() {
    while (true) {
      const num = queue.shift();
      if (num === undefined) return;
      const res = await checkNumber(num);
      state.set(num, res);
      fs.appendFileSync(stateFile, JSON.stringify({ key: num, result: res }) + "\n", "utf8");
      processed++;
      if (res.exists === true) onWa++;
      console.log(`  [${processed}] ${num}  ->  ${res.status}`);
      if (processed % 10 === 0) flushCsv();
    }
  }

  async function runQueue() {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  if (!WATCH) {
    await runQueue();
  } else {
    let idleChecks = 0;
    let stop = false;
    process.on("SIGINT", () => {
      stop = true;
      console.log("\n  Stopping (state saved — re-run to resume).");
    });
    while (!stop && idleChecks < 12) {
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
  console.log(`\n  Done. ${processed} numbers checked this run, ${onWa} on WhatsApp.`);
  console.log(`  WhatsApp CSV: ${outFile}\n`);
})().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
