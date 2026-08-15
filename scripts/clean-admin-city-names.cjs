#!/usr/bin/env node
// One-time cleanup for city names that are administrative units, not cities.
//
// Nominatim ranks a boundary above the settlement inside it - searching
// "Bhalwal" returns "Bhalwal Tehsil" (importance 0.395) ahead of the town
// "Bhalwal" (0.336) - and geo-resolve picked purely on importance. So searches
// were recorded under names like "Bhalwal Tehsil" and "Zone IV", which then
// became real cities in the warehouse, real rows in the public directory, and
// options in the find form's city dropdown.
//
// The source is fixed (web/lib/geo-resolve.cjs now prefers a place over a
// boundary and labels from the address block), and the form will no longer
// preselect one. This renames what is already stored.
//
// Renames rather than deletes: the leads under these names are real leads in
// roughly the right area, and deleting them to fix a label would be a much
// worse trade. "Bhalwal Tehsil" becomes "Bhalwal". A bare "Zone IV" carries no
// settlement name, so it is reported and left alone unless --drop-unfixable is
// passed, which hides those rows from the public directory only.
//
// Usage:
//   node scripts/clean-admin-city-names.cjs --dry-run
//   node scripts/clean-admin-city-names.cjs
//   node scripts/clean-admin-city-names.cjs --drop-unfixable
require("./load-env.cjs");
const { pool } = require("../web/lib/pg.cjs");

const DRY_RUN = process.argv.includes("--dry-run");
const DROP_UNFIXABLE = process.argv.includes("--drop-unfixable");

const UNIT = /\s+(tehsil|district|division|subdivision|county|prefecture|municipality|union council)$/i;
const BARE_ZONE = /^zone\s+[ivxlc\d]+$/i;

const isAdminUnit = (name) => UNIT.test(String(name || "").trim()) || BARE_ZONE.test(String(name || "").trim());
const fixName = (name) => String(name || "").trim().replace(UNIT, "").trim();

async function main() {
  const db = pool();
  console.log(DRY_RUN ? "DRY RUN - nothing will be written\n" : "Applying changes\n");

  // The public directory. The warehouse lives in its own database (see
  // web/lib/warehouse-pg.cjs); run this there too if the names appear in the
  // find form's dropdown as well as on the public site.
  const { rows } = await db.query(
    `SELECT slug, city_name, country_name, lead_count FROM public_searches ORDER BY city_name`
  );

  const renames = [];
  const unfixable = [];
  for (const r of rows) {
    if (!isAdminUnit(r.city_name)) continue;
    const next = fixName(r.city_name);
    if (next && next !== r.city_name) renames.push({ ...r, next });
    else unfixable.push(r);
  }

  console.log(`public_searches: ${rows.length} rows, ${renames.length} renameable, ${unfixable.length} without a settlement name`);
  for (const r of renames) console.log(`  rename  ${r.city_name}  ->  ${r.next}   (${r.country_name}, ${r.lead_count} leads)`);
  for (const r of unfixable) console.log(`  no fix  ${r.city_name}   (${r.country_name}, ${r.lead_count} leads)`);

  if (DRY_RUN) {
    console.log("\nDone (dry run). Re-run without --dry-run to apply.");
    await db.end();
    return;
  }

  for (const r of renames) {
    await db.query(`UPDATE public_searches SET city_name = $2 WHERE slug = $1`, [r.slug, r.next]);
  }
  if (DROP_UNFIXABLE && unfixable.length) {
    for (const r of unfixable) {
      await db.query(`DELETE FROM public_searches WHERE slug = $1`, [r.slug]);
    }
    console.log(`\nRemoved ${unfixable.length} unfixable rows from the public directory (their leads are untouched).`);
  }

  console.log(`\nDone. Renamed ${renames.length}.`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
