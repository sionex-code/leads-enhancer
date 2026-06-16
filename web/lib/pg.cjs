// Shared Postgres connection pool + Drizzle client. Used by the data layer
// (web/lib/db.cjs), the Auth.js adapter, the job queue, and the standalone
// runner. A single module-level pool is reused across the process.
require("../../scripts/load-env.cjs");
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const schema = require("./schema.cjs");

let _pool = null;
let _db = null;

function pool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot connect to Postgres");
  }
  // Managed Postgres (Supabase et al.) requires TLS. Supabase's pooler presents a
  // cert that doesn't chain to a public CA, so we enable SSL without strict
  // verification rather than fighting cert bundles in dev/prod-on-VPS.
  const ssl = /supabase\.com|sslmode=require|PGSSL/i.test(connectionString) || process.env.PGSSL
    ? { rejectUnauthorized: false }
    : undefined;
  _pool = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
  });
  _pool.on("error", (err) => {
    console.error("[pg] idle client error:", err.message);
  });
  return _pool;
}

function orm() {
  if (_db) return _db;
  _db = drizzle(pool(), { schema });
  return _db;
}

module.exports = { pool, orm, schema };
