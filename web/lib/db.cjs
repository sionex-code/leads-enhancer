// Central SQLite store: Gmail accounts (cookies, auto-rotated) + the global
// leads database (every scraped/enriched/audited lead across all projects,
// deduped so each business appears once).
//
// Dependency: better-sqlite3 (synchronous, fast, no server). The DB file lives
// at output/leads.db and is created on first use.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");
const DB_FILE = path.join(OUTPUT_DIR, "leads.db");

let _db = null;
function db() {
  if (_db) return _db;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  _db = new Database(DB_FILE);
  _db.pragma("journal_mode = WAL"); // concurrent reads while a runner writes
  _db.pragma("busy_timeout = 5000"); // wait instead of throwing when locked
  migrate(_db);
  return _db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cookies TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      use_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedup_key TEXT UNIQUE NOT NULL,
      name TEXT, category TEXT, rating TEXT, reviews TEXT,
      website TEXT, domain TEXT, phone TEXT, address TEXT,
      plus_code TEXT, hours TEXT, maps_url TEXT, image_urls TEXT,
      email TEXT, all_emails TEXT, contact_page TEXT,
      facebook TEXT, instagram TEXT, linkedin TEXT, twitter TEXT,
      youtube TEXT, tiktok TEXT, pinterest TEXT, whatsapp TEXT, telegram TEXT,
      enrich_status TEXT,
      whatsapp_status TEXT, whatsapp_id TEXT,
      desktop_performance INTEGER, desktop_seo INTEGER,
      desktop_accessibility INTEGER, desktop_best_practices INTEGER,
      mobile_performance INTEGER, mobile_seo INTEGER,
      mobile_accessibility INTEGER, mobile_best_practices INTEGER,
      project TEXT, query TEXT,
      first_seen TEXT NOT NULL, last_updated TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
    CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project);
    CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(last_updated);
  `);

  // Add columns introduced after a DB was first created (idempotent — keeps an
  // existing leads.db, like the one on the VPS, in sync without a rebuild).
  const have = new Set(d.prepare("PRAGMA table_info(leads)").all().map((c) => c.name));
  for (const col of ["youtube", "tiktok", "pinterest", "whatsapp", "telegram", "whatsapp_status", "whatsapp_id"]) {
    if (!have.has(col)) d.exec(`ALTER TABLE leads ADD COLUMN ${col} TEXT`);
  }
}

// ---- helpers ----------------------------------------------------------------
const now = () => new Date().toISOString();

function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

// Stable identity for a business across projects/runs: prefer its website
// domain, then its phone (digits only), then name+address. This is what makes
// "every lead stored once, unique" work.
function dedupKey(lead) {
  const domain = hostOf(lead.website || "");
  if (domain) return "d:" + domain;
  const phone = String(lead.phone || "").replace(/[^\d]/g, "");
  if (phone.length >= 7) return "p:" + phone;
  const name = String(lead.name || "").trim().toLowerCase();
  const addr = String(lead.address || "").trim().toLowerCase();
  if (name) return "n:" + name + "|" + addr;
  return "";
}

// ---- accounts (Gmail cookies, auto-rotated) ---------------------------------
function listAccounts() {
  return db()
    .prepare("SELECT id, name, enabled, created_at, last_used_at, use_count FROM accounts ORDER BY id")
    .all()
    .map((a) => ({ ...a, enabled: !!a.enabled }));
}

// Accept Cookie-Editor JSON (array), {cookies:[...]}, or a JSON string. Returns
// the stored account summary. Cookies are kept verbatim; scrape.js normalizes.
function addAccount(name, cookiesInput) {
  let cookies = cookiesInput;
  if (typeof cookies === "string") {
    cookies = JSON.parse(cookies);
  }
  if (cookies && !Array.isArray(cookies) && Array.isArray(cookies.cookies)) {
    cookies = cookies.cookies;
  }
  if (!Array.isArray(cookies) || !cookies.length) {
    throw new Error("Cookies must be a non-empty array (paste Cookie-Editor JSON)");
  }
  const info = db()
    .prepare("INSERT INTO accounts (name, cookies, enabled, created_at, use_count) VALUES (?, ?, 1, ?, 0)")
    .run(String(name || "Account").slice(0, 80), JSON.stringify(cookies), now());
  return { id: info.lastInsertRowid, name, count: cookies.length };
}

function deleteAccount(id) {
  db().prepare("DELETE FROM accounts WHERE id = ?").run(Number(id));
}

function setAccountEnabled(id, enabled) {
  db().prepare("UPDATE accounts SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, Number(id));
}

// Auto-rotation: hand out the enabled account used least recently (then lowest
// use_count). Concurrent project runs therefore spread across Gmail accounts.
// Returns { id, name, cookies } or null when no accounts exist.
function nextAccount() {
  const row = db()
    .prepare(
      `SELECT id, name, cookies FROM accounts
       WHERE enabled = 1
       ORDER BY (last_used_at IS NULL) DESC, last_used_at ASC, use_count ASC, id ASC
       LIMIT 1`
    )
    .get();
  if (!row) return null;
  db()
    .prepare("UPDATE accounts SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?")
    .run(now(), row.id);
  let cookies = [];
  try {
    cookies = JSON.parse(row.cookies);
  } catch {}
  return { id: row.id, name: row.name, cookies };
}

// ---- leads (global, deduped) ------------------------------------------------
const LEAD_COLUMNS = [
  "name", "category", "rating", "reviews", "website", "domain", "phone",
  "address", "plus_code", "hours", "maps_url", "image_urls",
  "email", "all_emails", "contact_page", "facebook", "instagram", "linkedin",
  "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram", "enrich_status",
  "whatsapp_status", "whatsapp_id",
  "desktop_performance", "desktop_seo", "desktop_accessibility", "desktop_best_practices",
  "mobile_performance", "mobile_seo", "mobile_accessibility", "mobile_best_practices",
  "project", "query",
];

// Map a CSV/lead object (camelCase or snake) onto our column names.
function normalizeLead(lead) {
  const g = (...keys) => {
    for (const k of keys) {
      if (lead[k] !== undefined && lead[k] !== null && lead[k] !== "") return lead[k];
    }
    return "";
  };
  const website = g("website");
  return {
    name: g("name"),
    category: g("category"),
    rating: g("rating"),
    reviews: g("reviews"),
    website,
    domain: hostOf(website) || g("domain"),
    phone: g("phone"),
    address: g("address"),
    plus_code: g("plusCode", "plus_code"),
    hours: g("hours"),
    maps_url: g("mapsUrl", "maps_url"),
    image_urls: g("imageUrls", "image_urls"),
    email: g("email"),
    all_emails: g("allEmails", "all_emails"),
    contact_page: g("contactPage", "contact_page"),
    facebook: g("facebook"),
    instagram: g("instagram"),
    linkedin: g("linkedin"),
    twitter: g("twitter"),
    youtube: g("youtube"),
    tiktok: g("tiktok"),
    pinterest: g("pinterest"),
    whatsapp: g("whatsapp"),
    telegram: g("telegram"),
    enrich_status: g("enrichStatus", "enrich_status"),
    whatsapp_status: g("whatsappStatus", "whatsapp_status"),
    whatsapp_id: g("whatsappId", "whatsapp_id"),
    desktop_performance: numOrNull(g("desktop_performance")),
    desktop_seo: numOrNull(g("desktop_seo")),
    desktop_accessibility: numOrNull(g("desktop_accessibility")),
    desktop_best_practices: numOrNull(g("desktop_best_practices")),
    mobile_performance: numOrNull(g("mobile_performance")),
    mobile_seo: numOrNull(g("mobile_seo")),
    mobile_accessibility: numOrNull(g("mobile_accessibility")),
    mobile_best_practices: numOrNull(g("mobile_best_practices")),
    project: g("project"),
    query: g("query"),
  };
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Upsert a batch. Existing rows are merged field-by-field: a new non-empty value
// overwrites, but a new empty value never wipes an existing one (so enrichment
// from a later run augments the scrape row instead of blanking it).
function upsertLeads(leadObjs) {
  const d = db();
  const ts = now();
  const selectStmt = d.prepare("SELECT * FROM leads WHERE dedup_key = ?");
  const insertStmt = d.prepare(
    `INSERT INTO leads (dedup_key, ${LEAD_COLUMNS.join(", ")}, first_seen, last_updated)
     VALUES (@dedup_key, ${LEAD_COLUMNS.map((c) => "@" + c).join(", ")}, @first_seen, @last_updated)`
  );
  const updateStmt = d.prepare(
    `UPDATE leads SET ${LEAD_COLUMNS.map((c) => `${c} = @${c}`).join(", ")}, last_updated = @last_updated
     WHERE dedup_key = @dedup_key`
  );

  let inserted = 0;
  let updated = 0;
  const tx = d.transaction((rows) => {
    for (const raw of rows) {
      const key = dedupKey(raw);
      if (!key) continue;
      const norm = normalizeLead(raw);
      const existing = selectStmt.get(key);
      if (!existing) {
        insertStmt.run({ dedup_key: key, ...norm, first_seen: ts, last_updated: ts });
        inserted++;
      } else {
        const merged = { dedup_key: key, last_updated: ts };
        for (const c of LEAD_COLUMNS) {
          const next = norm[c];
          const hasNext = next !== "" && next !== null && next !== undefined;
          merged[c] = hasNext ? next : existing[c];
        }
        updateStmt.run(merged);
        updated++;
      }
    }
  });
  tx(leadObjs);
  return { inserted, updated };
}

// Query for the viewer page. Supports text search, has-email, and a min score
// filter across either device's performance.
function queryLeads({ search = "", hasEmail = false, minScore = 0, project = "", limit = 2000, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (search) {
    where.push("(name LIKE @q OR domain LIKE @q OR phone LIKE @q OR address LIKE @q OR email LIKE @q OR category LIKE @q)");
    params.q = `%${search}%`;
  }
  if (hasEmail) where.push("email IS NOT NULL AND email != ''");
  if (project) {
    where.push("project = @project");
    params.project = project;
  }
  if (minScore > 0) {
    where.push("(COALESCE(desktop_performance,0) >= @min OR COALESCE(mobile_performance,0) >= @min)");
    params.min = Number(minScore);
  }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db().prepare(`SELECT COUNT(*) c FROM leads ${clause}`).get(params).c;
  const rows = db()
    .prepare(`SELECT * FROM leads ${clause} ORDER BY last_updated DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: Number(limit), offset: Number(offset) });
  return { total, rows };
}

function statsLeads() {
  const d = db();
  return {
    total: d.prepare("SELECT COUNT(*) c FROM leads").get().c,
    withEmail: d.prepare("SELECT COUNT(*) c FROM leads WHERE email IS NOT NULL AND email != ''").get().c,
    withWebsite: d.prepare("SELECT COUNT(*) c FROM leads WHERE website IS NOT NULL AND website != ''").get().c,
    audited: d.prepare("SELECT COUNT(*) c FROM leads WHERE desktop_performance IS NOT NULL OR mobile_performance IS NOT NULL").get().c,
    projects: d.prepare("SELECT COUNT(DISTINCT project) c FROM leads WHERE project != ''").get().c,
  };
}

const EXPORT_COLUMNS = ["dedup_key", ...LEAD_COLUMNS, "first_seen", "last_updated"];

function exportCsv() {
  const rows = db().prepare(`SELECT * FROM leads ORDER BY last_updated DESC`).all();
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [String.fromCharCode(0xfeff) + EXPORT_COLUMNS.join(",") + "\r\n"];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => esc(r[c])).join(",") + "\r\n");
  return lines.join("");
}

module.exports = {
  DB_FILE,
  hostOf,
  dedupKey,
  listAccounts,
  addAccount,
  deleteAccount,
  setAccountEnabled,
  nextAccount,
  upsertLeads,
  queryLeads,
  statsLeads,
  exportCsv,
};
