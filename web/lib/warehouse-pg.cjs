// Read-only connection to the scraper warehouse Postgres (separate DB/container
// from the app's own DATABASE_URL) - used only to surface lead counts in the
// admin panel. Connection: WAREHOUSE_DATABASE_URL=postgresql://user:pass@host:5433/warehouse
require("../../scripts/load-env.cjs");
const { Pool } = require("pg");

let _pool = null;

function pool() {
  if (_pool) return _pool;
  const connectionString = process.env.WAREHOUSE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("WAREHOUSE_DATABASE_URL is not set, so nothing can connect to warehouse Postgres");
  }
  _pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30000 });
  _pool.on("error", (err) => {
    console.error("[warehouse-pg] idle client error:", err.message);
  });
  return _pool;
}

// Leads (not keywords.lead_count, which double-counts pre-dedup hits) grouped
// by country, and by city, plus a grand total.
async function getStats() {
  const client = pool();

  const [{ rows: byCountry }, { rows: byCity }, { rows: totalRows }] = await Promise.all([
    client.query(`
      select co.name as country,
             count(distinct ci.id) as cities,
             count(l.id) as leads
        from countries co
        join cities ci on ci.country_id = co.id
        left join leads l on l.city_id = ci.id
       group by co.id, co.name
       order by leads desc nulls last
    `),
    client.query(`
      select ci.name as city, co.name as country,
             count(l.id) as leads
        from cities ci
        join countries co on co.id = ci.country_id
        left join leads l on l.city_id = ci.id
       group by ci.id, ci.name, co.name
       order by leads desc nulls last
    `),
    client.query(`select count(*)::int as total from leads`),
  ]);

  return {
    total: totalRows[0]?.total || 0,
    countries: byCountry.map((r) => ({ country: r.country, cities: Number(r.cities), leads: Number(r.leads) })),
    cities: byCity.map((r) => ({ city: r.city, country: r.country, leads: Number(r.leads) })),
  };
}

module.exports = { pool, getStats };
