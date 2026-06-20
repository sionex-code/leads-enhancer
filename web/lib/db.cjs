// Central Postgres data layer: per-user Gmail accounts (cookies, auto-rotated)
// + the per-tenant leads database (every scraped/enriched/audited lead, deduped
// per user so each business appears once *within a user's workspace*).
//
// Migrated from better-sqlite3 → node-postgres. All functions are now async and
// take an explicit `userId` for tenant isolation. Returned rows keep snake_case
// column names (what the API routes / UI already consume). The Drizzle schema in
// schema.cjs is the source of truth for DDL (drizzle-kit migrations); this module
// uses raw parameterized SQL for the hot CRUD paths.
const { pool } = require("./pg.cjs");

const q = (text, params = []) => pool().query(text, params);
const now = () => new Date().toISOString();

// ---- pure helpers (no DB) ---------------------------------------------------
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
// domain, then its phone (digits only), then name+address.
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

// Best-effort split of a freeform Google Maps address into city + country.
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
  for (const seg of segments.slice(1)) {
    if (!/\d/.test(seg) && seg.length >= 2) city = seg;
  }
  return { city, country };
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- scraper proxy pool (global, admin-managed) -----------------------------
// Normalize a pasted proxy into a canonical url. Accepts host:port,
// user:pass@host:port, or a full http(s):// url; defaults the scheme to http.
function normalizeProxyUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname || !u.port) return "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

async function listProxies() {
  const { rows } = await q(
    `SELECT id, url, label, enabled, created_at, last_used_at, use_count, fail_count
       FROM proxies ORDER BY id`
  );
  return rows.map((p) => ({ ...p, enabled: !!p.enabled }));
}

// Just the enabled proxy urls — what the scrapers rotate through.
async function listEnabledProxyUrls() {
  const { rows } = await q(`SELECT url FROM proxies WHERE enabled = 1 ORDER BY id`);
  return rows.map((r) => r.url);
}

// Bulk add from a pasted block (one proxy per line / comma-separated). Dedupes
// against what's already stored. Returns { added, total }.
async function addProxies(input) {
  const urls = [
    ...new Set(
      String(input || "")
        .split(/[\r\n,]+/)
        .map(normalizeProxyUrl)
        .filter(Boolean)
    ),
  ];
  let added = 0;
  for (const url of urls) {
    const res = await q(
      `INSERT INTO proxies (url, enabled, created_at, use_count, fail_count)
       VALUES ($1, 1, $2, 0, 0) ON CONFLICT (url) DO NOTHING`,
      [url, now()]
    );
    if (res.rowCount) added++;
  }
  return { added, total: urls.length };
}

async function deleteProxy(id) {
  await q(`DELETE FROM proxies WHERE id = $1`, [Number(id)]);
}

async function setProxyEnabled(id, enabled) {
  await q(`UPDATE proxies SET enabled = $1 WHERE id = $2`, [enabled ? 1 : 0, Number(id)]);
}

// ---- leads (per-tenant, deduped) --------------------------------------------
const LEAD_COLUMNS = [
  "name", "category", "rating", "reviews", "website", "domain", "phone",
  "address", "city", "country", "plus_code", "hours", "maps_url", "image_urls",
  "email", "all_emails", "contact_page", "facebook", "instagram", "linkedin",
  "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram", "enrich_status",
  "whatsapp_status", "whatsapp_id",
  "desktop_performance", "desktop_seo", "desktop_accessibility", "desktop_best_practices",
  "mobile_performance", "mobile_seo", "mobile_accessibility", "mobile_best_practices",
  "project", "query",
  "lat", "lng", "owner_replied", "owner_reply_count",
];
const INT_COLUMNS = new Set([
  "desktop_performance", "desktop_seo", "desktop_accessibility", "desktop_best_practices",
  "mobile_performance", "mobile_seo", "mobile_accessibility", "mobile_best_practices",
  "owner_replied", "owner_reply_count",
]);
// All numeric columns (integer + double precision). lat/lng are double precision,
// so they must merge with a plain COALESCE, not NULLIF(EXCLUDED.col, '') which
// would cast '' to the numeric type and error.
const NUMERIC_COLUMNS = new Set([...INT_COLUMNS, "lat", "lng"]);

// Map a CSV/lead object (camelCase or snake) onto our snake_case column names.
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
    lat: numOrNull(g("lat")),
    lng: numOrNull(g("lng")),
    owner_replied: numOrNull(g("owner_replied", "ownerReplied")),
    owner_reply_count: numOrNull(g("owner_reply_count", "ownerReplyCount")),
  };
}

// ---- shared enrichment cache (global, cross-tenant) -------------------------
// Once ANY user enriches a business website (emails + socials), the result is
// cached here keyed by domain (phone is a secondary lookup). Every later scrape
// or on-demand enrich for that same domain reuses the cached data instead of
// re-crawling the site — so an already-enriched business shows its email/socials
// immediately, with no second check.
const CACHE_FIELDS = [
  "email", "all_emails", "contact_page", "facebook", "instagram", "linkedin",
  "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram", "enrich_status",
];
const CACHE_SOCIALS = [
  "facebook", "instagram", "linkedin", "twitter", "youtube",
  "tiktok", "pinterest", "whatsapp", "telegram",
];

// Pull the cache columns off a lead/enrich object regardless of casing
// (enrichSite returns camelCase; normalizeLead / CSV rows are snake_case).
function cacheFieldsFrom(src) {
  const g = (...keys) => {
    for (const k of keys) {
      if (src[k] !== undefined && src[k] !== null && src[k] !== "") return String(src[k]);
    }
    return "";
  };
  return {
    email: g("email"),
    all_emails: g("all_emails", "allEmails"),
    contact_page: g("contact_page", "contactPage"),
    facebook: g("facebook"),
    instagram: g("instagram"),
    linkedin: g("linkedin"),
    twitter: g("twitter"),
    youtube: g("youtube"),
    tiktok: g("tiktok"),
    pinterest: g("pinterest"),
    whatsapp: g("whatsapp"),
    telegram: g("telegram"),
    enrich_status: g("enrich_status", "enrichStatus"),
  };
}

// Worth caching only once there's an actual email or social link (an
// enrich_status of "no email found" on its own must not poison the cache).
function hasUsefulEnrichment(f) {
  return !!(f.email || CACHE_SOCIALS.some((s) => f[s]));
}

// True when a cached enrichment row carries any reusable contact data (email OR a
// social/WhatsApp link). Lets every cache-hit path reuse socials-only businesses
// instead of re-crawling them just because they have no email.
function hasUsefulCache(row) {
  return hasUsefulEnrichment(cacheFieldsFrom(row || {}));
}

// One cached row by domain (preferred), else by phone (digits-only) — but a phone
// hit is only returned when it actually carries an email.
async function getCachedEnrichment({ domain = "", website = "", phone = "" } = {}) {
  const d = hostOf(domain) || hostOf(website);
  if (d) {
    const { rows } = await q(`SELECT * FROM enrichment_cache WHERE domain = $1`, [d]);
    if (rows[0]) return rows[0];
  }
  const ph = String(phone || "").replace(/[^\d]/g, "");
  if (ph.length >= 7) {
    const { rows } = await q(
      `SELECT * FROM enrichment_cache
        WHERE phone = $1 AND email IS NOT NULL AND email != ''
        ORDER BY updated_at DESC LIMIT 1`,
      [ph]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

// Bulk lookup for a batch of domains → Map(domain → cache row).
async function getCachedEnrichmentMap(domains = []) {
  const clean = [...new Set((domains || []).map((d) => hostOf(d)).filter(Boolean))];
  const map = new Map();
  if (!clean.length) return map;
  const { rows } = await q(`SELECT * FROM enrichment_cache WHERE domain = ANY($1::text[])`, [clean]);
  for (const r of rows) map.set(r.domain, r);
  return map;
}

// Upsert a domain's enrichment into the shared cache. No-op unless there's a
// domain and at least one useful field. Field-by-field merge: a new non-empty
// value fills/overwrites, an empty one never wipes an existing value.
async function saveCachedEnrichment(src = {}) {
  const domain = hostOf(src.domain || src.website || "");
  if (!domain) return;
  const f = cacheFieldsFrom(src);
  if (!hasUsefulEnrichment(f)) return;
  const phone = String(src.phone || "").replace(/[^\d]/g, "") || null;
  const ts = now();
  const cols = ["domain", "phone", ...CACHE_FIELDS, "source", "created_at", "updated_at"];
  const vals = [domain, phone, ...CACHE_FIELDS.map((c) => f[c]), src.source || "scrape", ts, ts];
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const setClause = ["phone", ...CACHE_FIELDS]
    .map((c) => `${c} = COALESCE(NULLIF(EXCLUDED.${c}, ''), enrichment_cache.${c})`)
    .join(", ");
  await q(
    `INSERT INTO enrichment_cache (${cols.join(", ")}) VALUES (${ph})
       ON CONFLICT (domain) DO UPDATE SET ${setClause}, updated_at = EXCLUDED.updated_at`,
    vals
  );
}

// ---- shared WhatsApp-status cache (global, cross-tenant) ---------------------
// A phone checked once by ANY user is reused by everyone, so we never re-run the
// WhatsApp lookup for the same number. Keyed by the normalized international
// number (digits only) the route already computes.
async function getCachedWhatsapp(phone) {
  const p = String(phone || "").replace(/[^\d]/g, "");
  if (!p) return null;
  const { rows } = await q(`SELECT status, whatsapp_id FROM whatsapp_cache WHERE phone = $1`, [p]);
  return rows[0] || null;
}

async function saveCachedWhatsapp(phone, status, whatsappId) {
  const p = String(phone || "").replace(/[^\d]/g, "");
  if (!p) return;
  await q(
    `INSERT INTO whatsapp_cache (phone, status, whatsapp_id, checked_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE SET
         status = EXCLUDED.status, whatsapp_id = EXCLUDED.whatsapp_id, checked_at = EXCLUDED.checked_at`,
    [p, status || "", whatsappId || "", now()]
  );
}

// Upsert a batch for a user. Field-by-field merge via ON CONFLICT: a new non-empty
// value overwrites, a new empty/null value never wipes an existing one.
async function upsertLeads(userId, leadObjs) {
  const insertCols = ["user_id", "dedup_key", ...LEAD_COLUMNS, "first_seen", "last_updated"];
  // Merge rule per column on conflict. Numeric columns (int + double precision)
  // must use a plain COALESCE: NULLIF(EXCLUDED.<col>, '') would force Postgres to
  // cast '' (text) to the column's numeric type, failing with
  // "invalid input syntax for type double precision: \"\"".
  const setClause = LEAD_COLUMNS.map((c) =>
    NUMERIC_COLUMNS.has(c)
      ? `${c} = COALESCE(EXCLUDED.${c}, leads.${c})`
      : `${c} = COALESCE(NULLIF(EXCLUDED.${c}, ''), leads.${c})`
  ).join(", ");
  // Build a single multi-row upsert for `rowCount` rows. Writing the whole batch
  // in one statement avoids a separate Supabase round-trip per lead (~250ms each
  // from the VPS) — the dominant cost of a find. ON CONFLICT still returns one row
  // per affected lead, so we can count inserts vs updates from RETURNING.
  const buildSql = (rowCount) => {
    const cpr = insertCols.length;
    const tuples = [];
    for (let r = 0; r < rowCount; r++) {
      tuples.push("(" + insertCols.map((_, c) => `$${r * cpr + c + 1}`).join(", ") + ")");
    }
    return `INSERT INTO leads (${insertCols.join(", ")})
    VALUES ${tuples.join(", ")}
    ON CONFLICT (user_id, dedup_key) DO UPDATE SET
      ${setClause}, last_updated = EXCLUDED.last_updated
    RETURNING (xmax = 0) AS inserted`;
  };

  // Normalize + dedup-key every row up front, dropping rows with no identity, and
  // dedupe by key WITHIN the batch — a multi-row ON CONFLICT can't touch the same
  // (user_id, dedup_key) twice. Later non-empty fields overwrite earlier ones,
  // matching the field-by-field merge the ON CONFLICT clause performs.
  // `ownEnrichment` records whether the scrape/import itself carried enrichment,
  // so we only write back to the shared cache data we actually discovered (not
  // values we just filled in from the cache).
  const byKey = new Map();
  for (const raw of leadObjs) {
    const key = dedupKey(raw);
    if (!key) continue;
    const norm = normalizeLead(raw);
    const existing = byKey.get(key);
    if (existing) {
      for (const c of LEAD_COLUMNS) {
        if (norm[c] !== "" && norm[c] != null) existing.norm[c] = norm[c];
      }
      existing.ownEnrichment = existing.ownEnrichment || hasUsefulEnrichment(cacheFieldsFrom(norm));
    } else {
      byKey.set(key, { key, norm, ownEnrichment: hasUsefulEnrichment(cacheFieldsFrom(norm)) });
    }
  }
  const prepared = [...byKey.values()];
  if (!prepared.length) return { inserted: 0, updated: 0 };

  // (a) Populate from the shared enrichment cache: any business already enriched
  // by ANY user has its MISSING email/socials filled in here, so it shows the
  // data immediately and the enrich step never has to re-crawl that site.
  try {
    const cacheMap = await getCachedEnrichmentMap(prepared.map((p) => p.norm.domain));
    if (cacheMap.size) {
      for (const p of prepared) {
        const cached = cacheMap.get(p.norm.domain);
        if (!cached) continue;
        for (const c of CACHE_FIELDS) {
          if (!p.norm[c] && cached[c]) p.norm[c] = cached[c];
        }
      }
    }
  } catch (err) {
    console.warn("[db] enrichment cache populate failed:", err.message);
  }

  const ts = now();
  let inserted = 0;
  let returned = 0;
  // 500 rows × ~45 cols ≈ 22.5k params, well under Postgres' 65535-param limit.
  const CHUNK = 500;
  const runChunk = async (runner, slice) => {
    const params = [];
    for (const p of slice) params.push(userId, p.key, ...LEAD_COLUMNS.map((c) => p.norm[c]), ts, ts);
    const res = await runner(buildSql(slice.length), params);
    for (const row of res.rows) { returned++; if (row.inserted) inserted++; }
  };
  if (prepared.length <= CHUNK) {
    // A single statement is atomic on its own — skip BEGIN/COMMIT round-trips.
    await runChunk(q, prepared);
  } else {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < prepared.length; i += CHUNK) {
        await runChunk((text, p) => client.query(text, p), prepared.slice(i, i + CHUNK));
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  const updated = returned - inserted;

  // (b) Save freshly-enriched businesses back to the shared cache so the next
  // user who scrapes the same domain reuses it — in one batched upsert rather than
  // a round-trip per domain. Only rows whose enrichment came from this
  // scrape/import (not values we just filled from the cache above).
  try {
    const cacheRows = [];
    const seenDomains = new Set();
    for (const p of prepared) {
      if (!p.ownEnrichment) continue;
      const domain = hostOf(p.norm.domain || p.norm.website || "");
      if (!domain || seenDomains.has(domain)) continue;
      const f = cacheFieldsFrom(p.norm);
      if (!hasUsefulEnrichment(f)) continue;
      seenDomains.add(domain);
      const phone = String(p.norm.phone || "").replace(/[^\d]/g, "") || null;
      cacheRows.push([domain, phone, ...CACHE_FIELDS.map((c) => f[c]), "scrape", ts, ts]);
    }
    if (cacheRows.length) {
      const cacheCols = ["domain", "phone", ...CACHE_FIELDS, "source", "created_at", "updated_at"];
      const cacheSet = ["phone", ...CACHE_FIELDS]
        .map((c) => `${c} = COALESCE(NULLIF(EXCLUDED.${c}, ''), enrichment_cache.${c})`)
        .join(", ");
      const cpr = cacheCols.length;
      const CHUNK2 = 800;
      for (let i = 0; i < cacheRows.length; i += CHUNK2) {
        const slice = cacheRows.slice(i, i + CHUNK2);
        const tuples = slice.map((_, r) =>
          "(" + cacheCols.map((__, c) => `$${r * cpr + c + 1}`).join(", ") + ")"
        ).join(", ");
        await q(
          `INSERT INTO enrichment_cache (${cacheCols.join(", ")}) VALUES ${tuples}
             ON CONFLICT (domain) DO UPDATE SET ${cacheSet}, updated_at = EXCLUDED.updated_at`,
          slice.flat()
        );
      }
    }
  } catch (err) {
    console.warn("[db] enrichment cache save failed:", err.message);
  }

  // Count newly-inserted leads against the user's monthly quota. Lazy-required to
  // avoid a circular dependency (billing → pg → ok; db → billing only here).
  if (inserted > 0) {
    try {
      await require("./billing.cjs").consumeLeads(userId, inserted);
    } catch (err) {
      console.warn("[db] quota consume failed:", err.message);
    }
  }
  return { inserted, updated };
}

// Query for the viewer page. Supports text search, workflow filters, has-email,
// and a min score filter across either device's performance. Always user-scoped.
async function queryLeads(
  userId,
  {
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
    list = "",
    limit = 2000,
    offset = 0,
  } = {}
) {
  const where = ["user_id = $1"];
  const params = [userId];
  const add = (val) => {
    params.push(val);
    return `$${params.length}`;
  };

  if (search) {
    const p = add(`%${search}%`);
    where.push(
      `(name ILIKE ${p} OR domain ILIKE ${p} OR phone ILIKE ${p} OR address ILIKE ${p} OR email ILIKE ${p} OR category ILIKE ${p} OR notes ILIKE ${p})`
    );
  }
  if (hasEmail) where.push("email IS NOT NULL AND email != ''");
  if (hasPhone) where.push("phone IS NOT NULL AND phone != ''");
  if (project) where.push(`lower(project) = lower(${add(project)})`);
  if (country) where.push(`lower(country) = lower(${add(country)})`);
  if (city) where.push(`lower(city) = lower(${add(city)})`);
  if (minScore > 0) {
    const p = add(Number(minScore));
    where.push(`(COALESCE(desktop_performance,0) >= ${p} OR COALESCE(mobile_performance,0) >= ${p})`);
  }
  if (watchlist) where.push("watchlist = 1");
  if (contactList) where.push("contact_list = 1");
  // Membership in a specific named list (leads are already user-scoped above, so an
  // arbitrary list_id can only ever match this user's own leads).
  if (list) where.push(`id IN (SELECT lead_id FROM list_members WHERE list_id = ${add(Number(list))})`);
  if (emailStatus) where.push(`email_status = ${add(emailStatus)}`);
  if (outreachStatus) where.push(`outreach_status = ${add(outreachStatus)}`);
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

  const clause = "WHERE " + where.join(" AND ");
  const totalRes = await q(`SELECT COUNT(*)::int AS c FROM leads ${clause}`, params);
  const total = totalRes.rows[0].c;
  const limP = add(Number(limit));
  const offP = add(Number(offset));
  const rowsRes = await q(
    `SELECT *,
            (SELECT COUNT(*)::int FROM list_members m JOIN lists l2 ON l2.id = m.list_id AND l2.user_id = $1
              WHERE m.lead_id = leads.id) AS list_count
       FROM leads ${clause} ORDER BY last_updated DESC LIMIT ${limP} OFFSET ${offP}`,
    params
  );
  return { total, rows: rowsRes.rows };
}

// ---- named lists (per-tenant, many-to-many via list_members) -----------------
async function listLists(userId) {
  const { rows } = await q(
    `SELECT l.id, l.name, l.created_at,
            (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = l.id) AS count
       FROM lists l WHERE l.user_id = $1 ORDER BY lower(l.name)`,
    [userId]
  );
  return rows;
}

// Create (or return existing, case-insensitive) named list for this user.
async function createList(userId, name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) throw new Error("List name is required");
  await q(
    `INSERT INTO lists (user_id, name, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, lower(name)) DO NOTHING`,
    [userId, clean, now()]
  );
  const { rows } = await q(`SELECT id, name, created_at FROM lists WHERE user_id = $1 AND lower(name) = lower($2)`, [userId, clean]);
  return rows[0];
}

// List ids (owned by this user) a lead currently belongs to.
async function getLeadListIds(userId, leadId) {
  const { rows } = await q(
    `SELECT m.list_id FROM list_members m
       JOIN lists l ON l.id = m.list_id AND l.user_id = $1
      WHERE m.lead_id = $2`,
    [userId, Number(leadId)]
  );
  return rows.map((r) => r.list_id);
}

// Replace a lead's membership with exactly `listIds` (this user's own lists only).
// Named lists are an independent dimension — contact_list / outreach are untouched.
async function setLeadLists(userId, leadId, listIds) {
  const id = Number(leadId);
  const { rows: owned } = await q(`SELECT id FROM lists WHERE user_id = $1`, [userId]);
  const ownedSet = new Set(owned.map((r) => r.id));
  const want = [...new Set((listIds || []).map(Number).filter((x) => ownedSet.has(x)))];
  await q(`DELETE FROM list_members WHERE lead_id = $1 AND list_id IN (SELECT id FROM lists WHERE user_id = $2)`, [id, userId]);
  for (const lid of want) {
    await q(`INSERT INTO list_members (list_id, lead_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [lid, id, now()]);
  }
  return want;
}

// Add many of this user's leads to one of their lists. Returns the count added.
async function addLeadsToList(userId, listId, leadIds) {
  const { rows: own } = await q(`SELECT id FROM lists WHERE id = $1 AND user_id = $2`, [Number(listId), userId]);
  if (!own[0]) throw new Error("List not found");
  const { rows: leads } = await q(`SELECT id FROM leads WHERE user_id = $1 AND id = ANY($2::int[])`, [userId, (leadIds || []).map(Number)]);
  const ids = leads.map((r) => r.id);
  if (!ids.length) return 0;
  // One multi-row insert instead of a query per id (avoids N remote round-trips).
  await q(
    `INSERT INTO list_members (list_id, lead_id, added_at)
       SELECT $1, lid, $3 FROM unnest($2::int[]) AS lid
       ON CONFLICT DO NOTHING`,
    [Number(listId), ids, now()]
  );
  return ids.length;
}

async function getLead(userId, id) {
  const { rows } = await q(`SELECT * FROM leads WHERE id = $1 AND user_id = $2`, [Number(id), userId]);
  return rows[0] || null;
}

async function deleteLead(userId, id) {
  const res = await q(`DELETE FROM leads WHERE id = $1 AND user_id = $2`, [Number(id), userId]);
  return res.rowCount;
}

async function updateLeadWorkflow(userId, id, patch = {}) {
  const current = await getLead(userId, id);
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
  await runUpdate(userId, id, updates);
  return getLead(userId, id);
}

// Build + run a dynamic positional UPDATE scoped to (id, user_id).
async function runUpdate(userId, id, updates) {
  const keys = Object.keys(updates);
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const vals = keys.map((k) => updates[k]);
  vals.push(Number(id), userId);
  await q(
    `UPDATE leads SET ${set} WHERE id = $${vals.length - 1} AND user_id = $${vals.length}`,
    vals
  );
}

async function createOrUpdateLead(userId, raw = {}) {
  const prepared = normalizeLead(raw);
  const key = dedupKey({ ...raw, ...prepared });
  if (!key) throw new Error("Add a website, phone, or lead name first");

  await upsertLeads(userId, [{ ...raw, ...prepared }]);
  const sel = await q(`SELECT * FROM leads WHERE dedup_key = $1 AND user_id = $2`, [key, userId]);
  let lead = sel.rows[0];
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

  if (Object.keys(patch).length) lead = await updateLeadWorkflow(userId, lead.id, patch);
  return lead;
}

// Save many leads at once and return their DB ids aligned to the input order
// (null for any input with no usable identity). Used by the dashboard's bulk
// actions (add-to-list / audit / report) so the selected captured rows are saved
// in ONE round-trip instead of one slow POST per lead. Reuses upsertLeads (shared
// enrichment cache + quota), then a single SELECT maps dedup_key → id.
async function bulkSaveLeads(userId, rawLeads = []) {
  const entries = (rawLeads || []).map((raw) => {
    const prepared = normalizeLead(raw);
    const merged = { ...raw, ...prepared };
    const key = dedupKey(merged);
    return key ? { key, merged } : null;
  });
  const valid = entries.filter(Boolean);
  if (valid.length) await upsertLeads(userId, valid.map((e) => e.merged));

  const keys = [...new Set(valid.map((e) => e.key))];
  const byKey = new Map();
  if (keys.length) {
    const { rows } = await q(
      `SELECT id, dedup_key FROM leads WHERE user_id = $1 AND dedup_key = ANY($2::text[])`,
      [userId, keys]
    );
    for (const r of rows) byKey.set(r.dedup_key, r.id);
  }
  // Aligned to input order: each input becomes { id, dedup_key } or null.
  return entries.map((e) => (e && byKey.has(e.key) ? { id: byKey.get(e.key), dedup_key: e.key } : null));
}

// Delete by domain/name match — used by the agent ("delete the lead for x.com").
async function deleteLeadsWhere(userId, { domain = "", search = "" } = {}) {
  if (domain) {
    const res = await q(`DELETE FROM leads WHERE user_id = $1 AND domain = $2`, [
      userId,
      String(domain).toLowerCase(),
    ]);
    return res.rowCount;
  }
  if (search) {
    const res = await q(
      `DELETE FROM leads WHERE user_id = $1 AND (name ILIKE $2 OR domain ILIKE $2)`,
      [userId, `%${search}%`]
    );
    return res.rowCount;
  }
  return 0;
}

async function listProjectNames(userId) {
  const { rows } = await q(
    `SELECT DISTINCT project FROM leads WHERE user_id = $1 AND project != '' ORDER BY project`,
    [userId]
  );
  return rows.map((r) => r.project);
}

async function listCountries(userId) {
  const { rows } = await q(
    `SELECT country AS name, COUNT(*)::int AS count FROM leads
      WHERE user_id = $1 AND country IS NOT NULL AND country != ''
      GROUP BY country ORDER BY count DESC, country`,
    [userId]
  );
  return rows;
}

async function listCities(userId, country = "") {
  if (country) {
    const { rows } = await q(
      `SELECT city AS name, COUNT(*)::int AS count FROM leads
        WHERE user_id = $1 AND city IS NOT NULL AND city != '' AND lower(country) = lower($2)
        GROUP BY city ORDER BY count DESC, city`,
      [userId, country]
    );
    return rows;
  }
  const { rows } = await q(
    `SELECT city AS name, COUNT(*)::int AS count FROM leads
      WHERE user_id = $1 AND city IS NOT NULL AND city != ''
      GROUP BY city ORDER BY count DESC, city`,
    [userId]
  );
  return rows;
}

// Persist enrichment / WhatsApp results onto a lead (on-demand single-lead).
const ENRICHABLE = new Set([
  "email", "all_emails", "contact_page", "facebook", "instagram", "linkedin",
  "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram",
  "enrich_status", "whatsapp_status", "whatsapp_id",
]);
async function updateLeadFields(userId, id, fields = {}, { overwrite = false } = {}) {
  const current = await getLead(userId, id);
  if (!current) return null;
  const updates = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ENRICHABLE.has(k)) continue;
    const val = v === null || v === undefined ? "" : String(v);
    if (overwrite || val !== "" || k === "enrich_status" || k === "whatsapp_status") {
      updates[k] = val;
    }
  }
  if (!Object.keys(updates).length) return current;
  updates.last_updated = now();
  await runUpdate(userId, id, updates);
  return getLead(userId, id);
}

// Persist website-status / chatbot-scan results onto a lead. Always overwrites;
// numeric/null values are written as-is.
const SCAN_FIELDS = new Set([
  "http_status", "http_status_text", "http_checked_at",
  "chatbot", "chatbot_vendors", "chatbot_method", "chatbot_checked_at",
]);
async function updateLeadScan(userId, id, fields = {}) {
  const current = await getLead(userId, id);
  if (!current) return null;
  const updates = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SCAN_FIELDS.has(k)) updates[k] = v === undefined ? null : v;
  }
  if (!Object.keys(updates).length) return current;
  updates.last_updated = now();
  await runUpdate(userId, id, updates);
  return getLead(userId, id);
}

// Persist quick-audit (real-Chrome Lighthouse, desktop + mobile) scores onto a
// lead so they show in the Health column. Scores are clamped 0-100 ints; missing
// devices are left untouched.
const AUDIT_SCORE_FIELDS = new Set([
  "desktop_performance", "desktop_seo", "desktop_accessibility", "desktop_best_practices",
  "mobile_performance", "mobile_seo", "mobile_accessibility", "mobile_best_practices",
]);
async function updateLeadAudit(userId, id, scores = {}) {
  const current = await getLead(userId, id);
  if (!current) return null;
  const updates = {};
  for (const [k, v] of Object.entries(scores)) {
    if (!AUDIT_SCORE_FIELDS.has(k)) continue;
    const n = numOrNull(v);
    if (n === null) continue; // never blank an existing score with a failed scan
    updates[k] = Math.max(0, Math.min(100, Math.round(n)));
  }
  if (!Object.keys(updates).length) return current;
  updates.last_updated = now();
  await runUpdate(userId, id, updates);
  return getLead(userId, id);
}

// Permanently delete a batch of the caller's own leads by id (bulk delete in the
// leads manager). Scoped to user_id so one tenant can never delete another's.
async function deleteLeadsByIds(userId, ids = []) {
  const clean = [...new Set((ids || []).map((x) => Number(x)).filter(Boolean))];
  if (!clean.length) return 0;
  const res = await q(`DELETE FROM leads WHERE user_id = $1 AND id = ANY($2::int[])`, [userId, clean]);
  return res.rowCount;
}

async function statsLeads(userId) {
  const { rows } = await q(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '')::int AS "withEmail",
       COUNT(*) FILTER (WHERE website IS NOT NULL AND website != '')::int AS "withWebsite",
       COUNT(*) FILTER (WHERE desktop_performance IS NOT NULL OR mobile_performance IS NOT NULL)::int AS audited,
       COUNT(DISTINCT project) FILTER (WHERE project != '')::int AS projects,
       COUNT(*) FILTER (WHERE watchlist = 1)::int AS watchlist,
       COUNT(*) FILTER (WHERE contact_list = 1)::int AS "contactList",
       COUNT(*) FILTER (WHERE email_status = 'send')::int AS "emailReady",
       COUNT(*) FILTER (WHERE outreach_status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE outreach_status = 'sent')::int AS sent,
       COUNT(*) FILTER (WHERE outreach_status = 'complete')::int AS completed
     FROM leads WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

const WORKFLOW_COLUMNS = ["watchlist", "contact_list", "email_status", "outreach_status", "notes", "last_contacted_at", "message_sent_at", "completed_at"];
const EXPORT_COLUMNS = ["dedup_key", ...LEAD_COLUMNS, ...WORKFLOW_COLUMNS, "first_seen", "last_updated"];

async function exportCsv(userId) {
  const { rows } = await q(`SELECT * FROM leads WHERE user_id = $1 ORDER BY last_updated DESC`, [userId]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [String.fromCharCode(0xfeff) + EXPORT_COLUMNS.join(",") + "\r\n"];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => esc(r[c])).join(",") + "\r\n");
  return lines.join("");
}

module.exports = {
  hostOf,
  dedupKey,
  parseLocation,
  normalizeProxyUrl,
  listProxies,
  listEnabledProxyUrls,
  addProxies,
  deleteProxy,
  setProxyEnabled,
  getCachedEnrichment,
  getCachedWhatsapp,
  saveCachedWhatsapp,
  getCachedEnrichmentMap,
  saveCachedEnrichment,
  hasUsefulCache,
  upsertLeads,
  queryLeads,
  getLead,
  deleteLead,
  updateLeadWorkflow,
  createOrUpdateLead,
  bulkSaveLeads,
  deleteLeadsWhere,
  updateLeadFields,
  updateLeadScan,
  updateLeadAudit,
  deleteLeadsByIds,
  listProjectNames,
  listCountries,
  listCities,
  statsLeads,
  exportCsv,
  listLists,
  createList,
  getLeadListIds,
  setLeadLists,
  addLeadsToList,
};
