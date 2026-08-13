#!/usr/bin/env node
// One-time cleanup for social URLs stored before web/lib/social-urls.cjs
// existed.
//
// The crawler's old check only rejected the obvious junk — login pages, share
// dialogs, /profile.php with no id — so directory indexes and share permalinks
// were saved as if they were profiles. "https://facebook.com/people" is the one
// that got reported: it renders as a Facebook icon on the lead and opens
// Facebook's people directory. The report crawler validated nothing at all.
//
// Extraction and rendering are both fixed, so nothing new arrives broken and
// nothing broken is displayed. This clears the stored values so exports, the
// API and anything reading the columns directly agree with the UI.
//
// Deterministic and offline: no network calls, no re-crawl. A value is either
// a profile URL by the shared rule or it is emptied. Values that only needed
// normalising (m.facebook.com, tracking parameters) are rewritten rather than
// dropped.
//
// Usage:
//   node scripts/clean-social-urls.cjs --dry-run   # report only, changes nothing
//   node scripts/clean-social-urls.cjs             # apply
require("./load-env.cjs");
const { pool } = require("../web/lib/pg.cjs");
const { cleanSocialUrl } = require("../web/lib/social-urls.cjs");

const DRY_RUN = process.argv.includes("--dry-run");

// Every table that stores a social URL per network, and the column each lives in.
const NETWORKS = [
  "facebook", "instagram", "linkedin", "twitter",
  "youtube", "tiktok", "pinterest", "whatsapp", "telegram",
];
const TABLES = ["leads", "enrichment_cache"];

const BATCH = 500;

async function cleanTable(db, table) {
  const cols = NETWORKS.join(", ");
  const anySet = NETWORKS.map((n) => `${n} IS NOT NULL AND ${n} <> ''`).join(" OR ");
  const { rows } = await db.query(`SELECT id, ${cols} FROM ${table} WHERE ${anySet}`);

  const updates = [];
  const stats = { rows: rows.length, cleared: 0, rewritten: 0, kept: 0 };
  const samples = [];

  for (const row of rows) {
    const patch = {};
    for (const network of NETWORKS) {
      const before = row[network];
      if (!before) continue;
      const after = cleanSocialUrl(before, network);
      if (after === before) { stats.kept++; continue; }
      patch[network] = after || null;
      if (after) stats.rewritten++;
      else stats.cleared++;
      if (samples.length < 15) samples.push(`  ${network}: ${before}  ->  ${after || "(cleared)"}`);
    }
    if (Object.keys(patch).length) updates.push({ id: row.id, patch });
  }

  console.log(`\n${table}: ${stats.rows} rows with socials`);
  console.log(`  valid as-is: ${stats.kept}   normalised: ${stats.rewritten}   cleared: ${stats.cleared}`);
  if (samples.length) console.log("  examples:\n" + samples.join("\n"));

  if (DRY_RUN || !updates.length) return stats;

  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    // One statement per row: the columns being written differ per row, so a
    // bulk form would need a full column list and would rewrite untouched
    // values as well.
    await Promise.all(
      chunk.map(({ id, patch }) => {
        const keys = Object.keys(patch);
        const sets = keys.map((k, n) => `${k} = $${n + 2}`).join(", ");
        return db.query(`UPDATE ${table} SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
      })
    );
    console.log(`  updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
  return stats;
}

async function main() {
  const db = pool();
  console.log(DRY_RUN ? "DRY RUN — nothing will be written" : "Applying changes");
  for (const table of TABLES) {
    try {
      await cleanTable(db, table);
    } catch (err) {
      console.error(`${table}: ${err.message}`);
    }
  }
  await db.end();
  console.log(DRY_RUN ? "\nDone (dry run). Re-run without --dry-run to apply." : "\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
