#!/usr/bin/env node
// Fill the shared enrichment cache for a public directory page.
//
// Why this exists: directory pages show real contact details for their best
// rows, but they can only show what enrichment has already found — the cache is
// populated as a side effect of users enriching their own leads, so a city
// nobody has worked has nothing to show. On the Stockholm painters page that
// meant 2 of 30 rows had an email and 0 had a social profile, and the page had
// nothing worth giving away.
//
// This crawls the page's own domains and writes what it finds into the shared,
// cross-tenant cache (the same table + shape the per-lead Enrich button
// writes), so the page has something real behind it.
//
//   node scripts/enrich-directory.cjs painter-leads-in-stockholm-se
//   node scripts/enrich-directory.cjs <slug> --limit 30 --force
//
// --force re-crawls domains already cached (default: skip them).
// Run it from the app directory, on a host whose .env.local points at the app
// and warehouse databases.

const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

const db = require("../web/lib/db.cjs");
const warehouse = require("../web/lib/warehouse.cjs");
const pub = require("../web/lib/public-searches.cjs");
const enrichLib = require("../enrich.cjs");

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("-"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : fallback;
};
const force = args.includes("--force");
const limit = Number(flag("limit", 30));

if (!slug) {
  console.error("usage: node scripts/enrich-directory.cjs <directory-slug> [--limit 30] [--force]");
  process.exit(1);
}

(async () => {
  const entry = await pub.bySlug(slug);
  if (!entry) {
    console.error(`No directory entry for "${slug}"`);
    process.exit(1);
  }

  const res = await warehouse.queryLeads({
    cityId: entry.cityId ?? undefined,
    countryCode: entry.cityId ? undefined : entry.countryCode || undefined,
    service: entry.service,
    limit,
  });
  const rows = (res.rows || []).filter((r) => r.website);
  const cached = await db.getCachedEnrichmentMap(rows.map((r) => r.website));

  const todo = rows.filter((r) => force || !cached.get(db.hostOf(r.website))?.email);
  console.log(
    `${entry.title}: ${rows.length} with a website, ${rows.length - todo.length} already cached, ${todo.length} to crawl`
  );

  let found = 0;
  for (const [i, row] of todo.entries()) {
    const host = db.hostOf(row.website);
    try {
      // One at a time on purpose: this hits real small-business sites, and a
      // burst of parallel requests from one IP is how you get blocked.
      const r = await enrichLib.enrichSite(row.website);
      await db.saveCachedEnrichment({
        domain: host,
        website: row.website,
        phone: row.phone,
        ...r,
        source: "directory",
      });
      const socials = ["facebook", "instagram", "linkedin"].filter((k) => r[k]).length;
      if (r.email) found++;
      console.log(`  [${i + 1}/${todo.length}] ${host} — ${r.email || "no email"}${socials ? `, ${socials} social` : ""}`);
    } catch (err) {
      console.log(`  [${i + 1}/${todo.length}] ${host} — failed: ${String(err.message || err).slice(0, 80)}`);
    }
  }

  console.log(`Done. ${found} of ${todo.length} crawled domains yielded an email.`);
  await enrichLib.closeBrowser().catch(() => {});
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
