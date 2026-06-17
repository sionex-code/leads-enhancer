// Idempotent runtime schema migration. Runs once at server boot (instrumentation.js)
// so every environment (VPS/pm2, Electron, dev) converges on the current schema
// without a manual drizzle-kit step. Every statement is safe to re-run.
//
// Covers the post-pivot additions:
//   - report credits columns on memberships
//   - app_settings (admin key/value: free monthly credits, etc.)
//   - proxies (global scraper proxy pool)
//   - enrichment_cache (global cross-tenant enrichment cache)
//   - one-time plan-key rename to the new $19/$35/$49 tiers (p49->p35, p99->p49)
const { pool } = require("./pg.cjs");

const STATEMENTS = [
  // ---- credits on memberships ----
  `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 0`,
  `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS credits_monthly integer`,
  `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS credits_renewed_at text`,

  // ---- global key/value settings ----
  `CREATE TABLE IF NOT EXISTS app_settings (
     key text PRIMARY KEY,
     value text,
     updated_at text
   )`,

  // ---- scraper proxy pool ----
  `CREATE TABLE IF NOT EXISTS proxies (
     id serial PRIMARY KEY,
     url text NOT NULL UNIQUE,
     label text,
     enabled integer NOT NULL DEFAULT 1,
     created_at text NOT NULL,
     last_used_at text,
     use_count integer NOT NULL DEFAULT 0,
     fail_count integer NOT NULL DEFAULT 0
   )`,

  // ---- shared enrichment cache ----
  `CREATE TABLE IF NOT EXISTS enrichment_cache (
     id serial PRIMARY KEY,
     domain text NOT NULL UNIQUE,
     phone text,
     email text,
     all_emails text,
     contact_page text,
     facebook text,
     instagram text,
     linkedin text,
     twitter text,
     youtube text,
     tiktok text,
     pinterest text,
     whatsapp text,
     telegram text,
     enrich_status text,
     source text,
     created_at text NOT NULL,
     updated_at text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_enrichment_cache_phone ON enrichment_cache (phone)`,

  // ---- named lead lists (per-tenant, many-to-many) ----
  `CREATE TABLE IF NOT EXISTS lists (
     id serial PRIMARY KEY,
     user_id text NOT NULL,
     name text NOT NULL,
     created_at text NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_user_name ON lists (user_id, lower(name))`,
  `CREATE TABLE IF NOT EXISTS list_members (
     list_id integer NOT NULL,
     lead_id integer NOT NULL,
     added_at text NOT NULL,
     PRIMARY KEY (list_id, lead_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_list_members_lead ON list_members (lead_id)`,

  // sensible defaults for the free monthly grant (only inserted if absent)
  `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('free_monthly_credits_enabled', '1', now()::text)
     ON CONFLICT (key) DO NOTHING`,
  `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('free_monthly_credits', '100', now()::text)
     ON CONFLICT (key) DO NOTHING`,
];

// The plan-key rename is NOT naturally idempotent (after renaming p99->p49, a
// second run would wrongly fold the new p49 into p35). Guard it behind a flag in
// app_settings so it executes exactly once.
async function renamePlanKeysOnce(client) {
  const flag = "migrated_plan_keys_v1";
  const { rows } = await client.query(`SELECT value FROM app_settings WHERE key = $1`, [flag]);
  if (rows[0]) return; // already done
  // Old tiers: p19($19,5k) p49($49,50k) p99($99,unlimited)
  // New tiers: p19($19,5k) p35($35,50k) p49($49,unlimited)
  await client.query(`UPDATE memberships SET plan = 'p35' WHERE plan = 'p49'`);
  await client.query(`UPDATE memberships SET plan = 'p49' WHERE plan = 'p99'`);
  await client.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, 'done', now()::text)
       ON CONFLICT (key) DO UPDATE SET value = 'done', updated_at = now()::text`,
    [flag]
  );
}

// Seed the shared enrichment cache from leads that were already enriched before
// the cache existed — otherwise re-scraping a previously-enriched business finds
// an empty cache and crawls it again. Picks the most-recently-updated enriched
// lead per domain. Guarded by a flag so the leads scan only runs once (the
// INSERT itself is also ON CONFLICT DO NOTHING, so re-running is harmless).
async function backfillEnrichmentCacheOnce(client) {
  const flag = "backfilled_enrichment_cache_v1";
  const { rows } = await client.query(`SELECT value FROM app_settings WHERE key = $1`, [flag]);
  if (rows[0]) return;
  const res = await client.query(
    `INSERT INTO enrichment_cache
       (domain, phone, email, all_emails, contact_page, facebook, instagram,
        linkedin, twitter, youtube, tiktok, pinterest, whatsapp, telegram,
        enrich_status, source, created_at, updated_at)
     SELECT DISTINCT ON (domain)
       domain,
       NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), ''),
       email, all_emails, contact_page, facebook, instagram, linkedin, twitter,
       youtube, tiktok, pinterest, whatsapp, telegram,
       COALESCE(NULLIF(enrich_status, ''), 'ok (backfill)'),
       'backfill', now()::text, now()::text
     FROM leads
     WHERE domain IS NOT NULL AND domain != ''
       AND email IS NOT NULL AND email != ''
     ORDER BY domain, last_updated DESC
     ON CONFLICT (domain) DO NOTHING`
  );
  await client.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, 'done', now()::text)
       ON CONFLICT (key) DO UPDATE SET value = 'done', updated_at = now()::text`,
    [flag]
  );
  console.log(`[migrate] backfilled enrichment_cache from ${res.rowCount} existing enriched lead(s)`);
}

let _done = false;
async function ensureSchema() {
  if (_done) return;
  const client = await pool().connect();
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
    }
    await renamePlanKeysOnce(client);
    await backfillEnrichmentCacheOnce(client);
    _done = true;
    console.log("[migrate] schema ensured (credits, proxies, enrichment_cache, app_settings)");
  } catch (err) {
    // Never let a migration hiccup take down boot — log and let the app start;
    // routes that need a missing column will surface a clear error instead.
    console.error("[migrate] ensureSchema failed:", err.message);
  } finally {
    client.release();
  }
}

module.exports = { ensureSchema };
