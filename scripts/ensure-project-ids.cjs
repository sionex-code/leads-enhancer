#!/usr/bin/env node
// Backfills and de-duplicates project.json's `publicId` across every tenant.
//
// publicId is the short support-reference code shown on each project. Until
// now it was generated with a bare Math.random().toString(36) and never
// checked against anything, so two things could be true of the existing data:
// a project created before the field existed has none at all, and two
// projects can legitimately hold the same code - 36^6 candidates sounds like
// a lot until a tenant has a few hundred projects and the birthday paradox
// stops being theoretical. New projects go through store.uniquePublicId,
// which checks; this repairs what is already on disk.
//
// Per-tenant, not global: a project is only ever looked up within its own
// tenant, so uniqueness only has to hold there - same scope uniquePublicId
// uses.
//
// Usage:
//   node scripts/ensure-project-ids.cjs --dry-run
//   node scripts/ensure-project-ids.cjs
require("./load-env.cjs");
const fs = require("fs");
const path = require("path");
const store = require("../web/lib/store.cjs");

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_ROOT = process.env.GMAPS_DATA_DIR || process.cwd();
const TENANTS_DIR = path.join(DATA_ROOT, "tenants");

function main() {
  console.log(DRY_RUN ? "DRY RUN - nothing will be written\n" : "Applying changes\n");

  if (!fs.existsSync(TENANTS_DIR)) {
    console.log(`No tenants directory at ${TENANTS_DIR} - nothing to do.`);
    return;
  }

  let tenantsSeen = 0;
  let totalProjects = 0;
  let backfilled = 0;
  let deduped = 0;

  for (const userId of fs.readdirSync(TENANTS_DIR)) {
    const projectsRoot = path.join(TENANTS_DIR, userId, "output", "projects");
    if (!fs.existsSync(projectsRoot)) continue;
    tenantsSeen++;

    const seen = new Set();
    for (const slug of fs.readdirSync(projectsRoot)) {
      const dir = path.join(projectsRoot, slug);
      if (!fs.statSync(dir).isDirectory()) continue;
      const metaFile = path.join(dir, "project.json");
      if (!fs.existsSync(metaFile)) continue;
      totalProjects++;

      const meta = store.readMeta(dir);
      const current = meta.publicId || "";
      const isDup = current && seen.has(current);
      if (!current || isDup) {
        const fresh = store.uniquePublicId(userId);
        console.log(
          `  ${isDup ? "dedupe " : "backfill"}  ${userId.slice(0, 8)}/${slug}  ` +
          `${current || "(none)"} -> ${fresh}`
        );
        if (isDup) deduped++; else backfilled++;
        if (!DRY_RUN) store.writeMeta(dir, { publicId: fresh });
        seen.add(fresh);
      } else {
        seen.add(current);
      }
    }
  }

  console.log(`\n${tenantsSeen} tenants, ${totalProjects} projects checked.`);
  console.log(`${backfilled} missing an id, ${deduped} duplicates. ${backfilled + deduped} changed.`);
  console.log(DRY_RUN ? "\nDone (dry run). Re-run without --dry-run to apply." : "\nDone.");
}

main();
