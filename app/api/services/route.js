import fs from "fs";
import path from "path";
import warehouse from "../../../web/lib/warehouse.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// GET /api/services -> { services: ["Plumber", "Restaurant", ...] }
//
// Business categories for a LIVE search. The warehouse catalog only lists the
// ~46 services we already hold leads for — the right list for a warehouse
// lookup, and far too narrow for a live scrape, which can search any business
// type on the map.
//
// Source is the Google Business Profile category list (data/services.json,
// ~3,968 entries) with the warehouse's own service names merged in, so anything
// searchable from the warehouse is also offered here and nothing we actually
// stock can fall out of the list.
//
// Small enough (~23KB gzipped) to send once and filter in the browser, unlike
// the 152,970 cities, which have to be fetched per country.

// cwd, not __dirname: Next bundles server code into .next/server/chunks, so a
// relative __dirname walk would resolve inside .next. Matches web/lib/store.cjs.
const APP_ROOT = process.env.GMAPS_APP_ROOT || process.cwd();

let _cache = null;

function baseCategories() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "data", "services.json"), "utf8"));
  } catch {
    _cache = [];
  }
  return _cache;
}

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const base = baseCategories();

  // Never fatal: a warehouse outage must not empty the picker, and a missing
  // data file must not either. Whichever list survives is still useful.
  let ours = [];
  try {
    const cat = await warehouse.catalog();
    ours = (cat?.services || []).map((s) => s.name).filter(Boolean);
  } catch {
    ours = [];
  }

  const seen = new Map();
  for (const s of [...ours, ...base]) {
    const v = String(s || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (!seen.has(k)) seen.set(k, v);
  }

  return Response.json({ services: [...seen.values()].sort((a, b) => a.localeCompare(b)) });
}
