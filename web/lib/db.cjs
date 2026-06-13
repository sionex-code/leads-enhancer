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
      city TEXT, country TEXT,
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
      watchlist INTEGER NOT NULL DEFAULT 0,
      contact_list INTEGER NOT NULL DEFAULT 0,
      email_status TEXT NOT NULL DEFAULT 'unset',
      outreach_status TEXT NOT NULL DEFAULT 'new',
      notes TEXT,
      last_contacted_at TEXT,
      message_sent_at TEXT,
      completed_at TEXT,
      first_seen TEXT NOT NULL, last_updated TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
    CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project);
    CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(last_updated);
  `);

  // Add columns introduced after a DB was first created (idempotent — keeps an
  // existing leads.db, like the one on the VPS, in sync without a rebuild).
  const have = new Set(d.prepare("PRAGMA table_info(leads)").all().map((c) => c.name));
  const textColumns = ["youtube", "tiktok", "pinterest", "whatsapp", "telegram", "whatsapp_status", "whatsapp_id", "city", "country"];
  const addedCity = !have.has("city");
  for (const col of textColumns) {
    if (!have.has(col)) d.exec(`ALTER TABLE leads ADD COLUMN ${col} TEXT`);
  }
  const workflowColumns = {
    watchlist: "INTEGER NOT NULL DEFAULT 0",
    contact_list: "INTEGER NOT NULL DEFAULT 0",
    email_status: "TEXT NOT NULL DEFAULT 'unset'",
    outreach_status: "TEXT NOT NULL DEFAULT 'new'",
    notes: "TEXT",
    last_contacted_at: "TEXT",
    message_sent_at: "TEXT",
    completed_at: "TEXT",
  };
  for (const [col, type] of Object.entries(workflowColumns)) {
    if (!have.has(col)) d.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
  }
  d.exec("CREATE INDEX IF NOT EXISTS idx_leads_country ON leads(country)");

  // One-time backfill: derive city/country from the existing address text so the
  // grouping/filters work on leads scraped before these columns existed.
  if (addedCity) {
    const rows = d.prepare("SELECT id, address FROM leads WHERE address IS NOT NULL AND address != ''").all();
    const upd = d.prepare("UPDATE leads SET city = @city, country = @country WHERE id = @id");
    const tx = d.transaction((list) => {
      for (const r of list) {
        const { city, country } = parseLocation(r.address);
        if (city || country) upd.run({ id: r.id, city, country });
      }
    });
    tx(rows);
  }
}

// Best-effort split of a freeform Google Maps address into a city + country for
// grouping. Addresses look like "123 Main St, Miami, FL 33101, USA" (country may
// be absent). The last letters-only segment is treated as the country; the city
// is the last non-street segment that has no digits.
function parseLocation(address) {
  const segments = String(address || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return { city: "", country: "" };
  let country = "";
  const last = segments[segments.length - 1];
  if (/^[A-Za-zÀ-ɏ .'’&-]{2,40}$/.test(last)) {
    country = last;
    segments.pop();
  }
  let city = "";
  // Drop the first segment (usually the street) and pick the last digit-free part.
  for (const seg of segments.slice(1)) {
    if (!/\d/.test(seg) && seg.length >= 2) city = seg;
  }
  return { city, country };
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
  "address", "city", "country", "plus_code", "hours", "maps_url", "image_urls",
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
  const address = g("address");
  const loc = parseLocation(address);
  return {
    name: g("name"),
    category: g("category"),
    rating: g("rating"),
    reviews: g("reviews"),
    website,
    domain: hostOf(website) || g("domain"),
    phone: g("phone"),
    address,
    city: g("city") || loc.city,
    country: g("country") || loc.country,
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

// Query for the viewer page. Supports text search, workflow filters, has-email,
// and a min score filter across either device's performance.
function queryLeads({
  search = "",
  hasEmail = false,
  hasPhone = false,
  minScore = 0,
  project = "",
  country = "",
  city = "",
  workflow = "",
  emailStatus = "",
  outreachStatus = "",
  watchlist = false,
  contactList = false,
  limit = 2000,
  offset = 0,
} = {}) {
  const where = [];
  const params = {};
  if (search) {
    where.push("(name LIKE @q OR domain LIKE @q OR phone LIKE @q OR address LIKE @q OR email LIKE @q OR category LIKE @q OR notes LIKE @q)");
    params.q = `%${search}%`;
  }
  if (hasEmail) where.push("email IS NOT NULL AND email != ''");
  if (hasPhone) where.push("phone IS NOT NULL AND phone != ''");
  if (project) {
    where.push("project = @project COLLATE NOCASE");
    params.project = project;
  }
  if (country) {
    where.push("country = @country COLLATE NOCASE");
    params.country = country;
  }
  if (city) {
    where.push("city = @city COLLATE NOCASE");
    params.city = city;
  }
  if (minScore > 0) {
    where.push("(COALESCE(desktop_performance,0) >= @min OR COALESCE(mobile_performance,0) >= @min)");
    params.min = Number(minScore);
  }
  if (watchlist) where.push("watchlist = 1");
  if (contactList) where.push("contact_list = 1");
  if (emailStatus) {
    where.push("email_status = @emailStatus");
    params.emailStatus = emailStatus;
  }
  if (outreachStatus) {
    where.push("outreach_status = @outreachStatus");
    params.outreachStatus = outreachStatus;
  }
  if (workflow === "watchlist") where.push("watchlist = 1");
  if (workflow === "contacts") where.push("contact_list = 1");
  if (workflow === "email-ready") where.push("email_status = 'send'");
  if (workflow === "queued") where.push("outreach_status = 'queued'");
  if (workflow === "sent") where.push("outreach_status = 'sent'");
  if (workflow === "complete") where.push("outreach_status = 'complete'");
  if (workflow === "skipped") where.push("outreach_status = 'skipped'");
  if (workflow === "needs-action") {
    where.push("(contact_list = 1 OR watchlist = 1 OR email_status = 'send')");
    where.push("outreach_status NOT IN ('sent', 'complete', 'skipped')");
  }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db().prepare(`SELECT COUNT(*) c FROM leads ${clause}`).get(params).c;
  const rows = db()
    .prepare(`SELECT * FROM leads ${clause} ORDER BY last_updated DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: Number(limit), offset: Number(offset) });
  return { total, rows };
}

function getLead(id) {
  return db().prepare("SELECT * FROM leads WHERE id = ?").get(Number(id)) || null;
}

function deleteLead(id) {
  return db().prepare("DELETE FROM leads WHERE id = ?").run(Number(id)).changes;
}

function updateLeadWorkflow(id, patch = {}) {
  const d = db();
  const current = getLead(id);
  if (!current) return null;

  const allowedEmail = new Set(["unset", "send", "do_not_send", "later"]);
  const allowedOutreach = new Set(["new", "queued", "sent", "complete", "skipped"]);
  const updates = {};
  const boolish = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);

  if (patch.watchlist !== undefined) updates.watchlist = boolish(patch.watchlist);
  if (patch.contact_list !== undefined) updates.contact_list = boolish(patch.contact_list);
  if (patch.contactList !== undefined) updates.contact_list = boolish(patch.contactList);
  if (patch.email_status !== undefined && allowedEmail.has(String(patch.email_status))) updates.email_status = String(patch.email_status);
  if (patch.emailStatus !== undefined && allowedEmail.has(String(patch.emailStatus))) updates.email_status = String(patch.emailStatus);
  if (patch.outreach_status !== undefined && allowedOutreach.has(String(patch.outreach_status))) updates.outreach_status = String(patch.outreach_status);
  if (patch.outreachStatus !== undefined && allowedOutreach.has(String(patch.outreachStatus))) updates.outreach_status = String(patch.outreachStatus);
  if (patch.notes !== undefined) updates.notes = String(patch.notes || "").slice(0, 8000);

  const nextOutreach = updates.outreach_status || current.outreach_status || "new";
  if (nextOutreach === "sent" && !current.message_sent_at) {
    updates.message_sent_at = now();
    updates.last_contacted_at = updates.message_sent_at;
  }
  if (nextOutreach === "complete" && !current.completed_at) {
    updates.completed_at = now();
    updates.last_contacted_at = updates.last_contacted_at || now();
  }

  if (!Object.keys(updates).length) return current;
  updates.last_updated = now();
  const set = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
  d.prepare(`UPDATE leads SET ${set} WHERE id = @id`).run({ ...updates, id: Number(id) });
  return getLead(id);
}

function createOrUpdateLead(raw = {}) {
  const prepared = normalizeLead(raw);
  const key = dedupKey({ ...raw, ...prepared });
  if (!key) throw new Error("Add a website, phone, or lead name first");

  upsertLeads([{ ...raw, ...prepared }]);
  let lead = db().prepare("SELECT * FROM leads WHERE dedup_key = ?").get(key);
  if (!lead) throw new Error("Lead was not saved");

  const patch = {};
  if (raw.watchlist !== undefined) patch.watchlist = raw.watchlist;
  if (raw.contact_list !== undefined) patch.contact_list = raw.contact_list;
  if (raw.contactList !== undefined) patch.contact_list = raw.contactList;
  if (raw.email_status !== undefined) patch.email_status = raw.email_status;
  if (raw.emailStatus !== undefined) patch.email_status = raw.emailStatus;
  if (raw.outreach_status !== undefined) patch.outreach_status = raw.outreach_status;
  if (raw.outreachStatus !== undefined) patch.outreach_status = raw.outreachStatus;
  if (raw.notes !== undefined) patch.notes = raw.notes;

  if (Object.keys(patch).length) lead = updateLeadWorkflow(lead.id, patch);
  return lead;
}

// Delete by domain/name match — used by the agent ("delete the lead for x.com").
function deleteLeadsWhere({ domain = "", search = "" } = {}) {
  if (domain) return db().prepare("DELETE FROM leads WHERE domain = ?").run(String(domain).toLowerCase()).changes;
  if (search) return db().prepare("DELETE FROM leads WHERE name LIKE ? OR domain LIKE ?").run(`%${search}%`, `%${search}%`).changes;
  return 0;
}

function listProjectNames() {
  return db()
    .prepare("SELECT DISTINCT project FROM leads WHERE project != '' ORDER BY project")
    .all()
    .map((r) => r.project);
}

// Distinct countries (with lead counts) for the location filter/grouping.
function listCountries() {
  return db()
    .prepare("SELECT country AS name, COUNT(*) AS count FROM leads WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY count DESC, country")
    .all();
}

// Distinct cities for the location filter, optionally scoped to one country.
function listCities(country = "") {
  if (country) {
    return db()
      .prepare("SELECT city AS name, COUNT(*) AS count FROM leads WHERE city IS NOT NULL AND city != '' AND country = ? COLLATE NOCASE GROUP BY city ORDER BY count DESC, city")
      .all(country);
  }
  return db()
    .prepare("SELECT city AS name, COUNT(*) AS count FROM leads WHERE city IS NOT NULL AND city != '' GROUP BY city ORDER BY count DESC, city")
    .all();
}

// Persist enrichment / WhatsApp results onto a lead (from on-demand single-lead
// actions). Only contact/social/audit columns are writable here; empty values
// never overwrite an existing non-empty one, matching the batch upsert merge rule.
const ENRICHABLE = new Set([
  "email", "all_emails", "contact_page", "facebook", "instagram", "linkedin",
  "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram",
  "enrich_status", "whatsapp_status", "whatsapp_id",
]);
function updateLeadFields(id, fields = {}, { overwrite = false } = {}) {
  const current = getLead(id);
  if (!current) return null;
  const updates = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ENRICHABLE.has(k)) continue;
    const val = v === null || v === undefined ? "" : String(v);
    // enrich_status / whatsapp_status are always written (they report the outcome);
    // other fields only when non-empty unless overwrite is requested.
    if (overwrite || val !== "" || k === "enrich_status" || k === "whatsapp_status") {
      updates[k] = val;
    }
  }
  if (!Object.keys(updates).length) return current;
  updates.last_updated = now();
  const set = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
  db().prepare(`UPDATE leads SET ${set} WHERE id = @id`).run({ ...updates, id: Number(id) });
  return getLead(id);
}

function statsLeads() {
  const d = db();
  return {
    total: d.prepare("SELECT COUNT(*) c FROM leads").get().c,
    withEmail: d.prepare("SELECT COUNT(*) c FROM leads WHERE email IS NOT NULL AND email != ''").get().c,
    withWebsite: d.prepare("SELECT COUNT(*) c FROM leads WHERE website IS NOT NULL AND website != ''").get().c,
    audited: d.prepare("SELECT COUNT(*) c FROM leads WHERE desktop_performance IS NOT NULL OR mobile_performance IS NOT NULL").get().c,
    projects: d.prepare("SELECT COUNT(DISTINCT project) c FROM leads WHERE project != ''").get().c,
    watchlist: d.prepare("SELECT COUNT(*) c FROM leads WHERE watchlist = 1").get().c,
    contactList: d.prepare("SELECT COUNT(*) c FROM leads WHERE contact_list = 1").get().c,
    emailReady: d.prepare("SELECT COUNT(*) c FROM leads WHERE email_status = 'send'").get().c,
    queued: d.prepare("SELECT COUNT(*) c FROM leads WHERE outreach_status = 'queued'").get().c,
    sent: d.prepare("SELECT COUNT(*) c FROM leads WHERE outreach_status = 'sent'").get().c,
    completed: d.prepare("SELECT COUNT(*) c FROM leads WHERE outreach_status = 'complete'").get().c,
  };
}

const WORKFLOW_COLUMNS = ["watchlist", "contact_list", "email_status", "outreach_status", "notes", "last_contacted_at", "message_sent_at", "completed_at"];
const EXPORT_COLUMNS = ["dedup_key", ...LEAD_COLUMNS, ...WORKFLOW_COLUMNS, "first_seen", "last_updated"];

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
  getLead,
  deleteLead,
  updateLeadWorkflow,
  createOrUpdateLead,
  deleteLeadsWhere,
  updateLeadFields,
  listProjectNames,
  listCountries,
  listCities,
  parseLocation,
  statsLeads,
  exportCsv,
};
