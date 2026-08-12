#!/usr/bin/env node
// One-time repair for whatsapp_id values stored before the "@lid" fix in
// whatsapp.cjs (checkOnce): WhatsApp sometimes returns a "@lid" (linked id,
// an internal WhatsApp identifier) instead of the classic phone-based "@c.us"
// JID, and the code used to trust it blindly, so a wa.me link built from it
// was broken. The check itself is fixed going forward; this repairs data that
// was already cached/stored with a bad id, without re-hitting the WhatsApp API.
//
// Deterministic, no network calls:
//   - whatsapp_cache.phone IS the exact number that was queried, so any row
//     whose whatsapp_id isn't "<phone>@c.us" gets corrected to that.
//   - leads.whatsapp_id gets re-derived the same way the check route does:
//     normalizePhone(lead.phone, dialingCode(lead.country)) + "@c.us". If that
//     can't be computed (no phone / unknown country), the stored id is cleared
//     and whatsapp_status reset so the lead surfaces for a normal re-check.
//
// Usage: node scripts/fix-whatsapp-lid-cache.cjs [--dry-run]
require("./load-env.cjs");
const { pool } = require("../web/lib/pg.cjs");
const waLib = require("../modules/whatsapp/index.cjs");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = pool();

  // ---- whatsapp_cache: deterministic, phone column is the source of truth ----
  const cacheRows = (
    await db.query(
      `SELECT phone, whatsapp_id FROM whatsapp_cache
       WHERE whatsapp_id IS NOT NULL AND whatsapp_id <> '' AND whatsapp_id !~* '@c\\.us$'`
    )
  ).rows;
  console.log(`whatsapp_cache: ${cacheRows.length} row(s) with a non-@c.us id`);
  for (const row of cacheRows) {
    const fixed = `${row.phone}@c.us`;
    console.log(`  ${row.phone}: ${row.whatsapp_id} -> ${fixed}`);
    if (!DRY_RUN) {
      await db.query(`UPDATE whatsapp_cache SET whatsapp_id = $1 WHERE phone = $2`, [fixed, row.phone]);
    }
  }

  // ---- leads: re-derive the number the same way the check route computes it ----
  const leadRows = (
    await db.query(
      `SELECT id, phone, country, whatsapp_id FROM leads
       WHERE whatsapp_id IS NOT NULL AND whatsapp_id <> '' AND whatsapp_id !~* '@c\\.us$'`
    )
  ).rows;
  console.log(`leads: ${leadRows.length} row(s) with a non-@c.us id`);
  let fixedCount = 0;
  let clearedCount = 0;
  for (const row of leadRows) {
    const cc = waLib.dialingCode(row.country);
    const number = waLib.normalizePhone(row.phone, cc);
    if (number) {
      const fixed = `${number}@c.us`;
      console.log(`  lead ${row.id}: ${row.whatsapp_id} -> ${fixed}`);
      fixedCount++;
      if (!DRY_RUN) {
        await db.query(`UPDATE leads SET whatsapp_id = $1 WHERE id = $2`, [fixed, row.id]);
      }
    } else {
      console.log(`  lead ${row.id}: ${row.whatsapp_id} -> cleared (couldn't re-derive a number), status reset`);
      clearedCount++;
      if (!DRY_RUN) {
        await db.query(`UPDATE leads SET whatsapp_id = '', whatsapp_status = '' WHERE id = $1`, [row.id]);
      }
    }
  }
  console.log(`leads: ${fixedCount} fixed, ${clearedCount} cleared for re-check${DRY_RUN ? " (dry run — nothing written)" : ""}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
