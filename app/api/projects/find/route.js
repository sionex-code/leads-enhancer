import path from "path";
import fs from "fs";
import store from "../../../../web/lib/store.cjs";
import db from "../../../../web/lib/db.cjs";
import warehouse from "../../../../web/lib/warehouse.cjs";
import billing from "../../../../web/lib/billing.cjs";
import settings from "../../../../web/lib/settings.cjs";
import queue from "../../../../web/lib/queue.cjs";
import waLib from "../../../../modules/whatsapp/index.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// CSV header columns (must match what latestRawCsv / loadStatus expects).
const CSV_HEADERS = [
  "name", "category", "rating", "reviews", "website", "phone", "address",
  "plus_code", "hours", "maps_url", "lat", "lng",
  "email", "all_emails", "contact_page",
  "facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram",
  "owner_replied", "owner_reply_count",
  "whatsapp_status", "whatsapp_id", "enrich_status",
];

// Social networks shared between the cache backfill and buildCsv.
const SOCIAL_KEYS = ["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest", "whatsapp", "telegram"];

// Bare hostname for a website (drops protocol + www), to key the enrichment cache.
function hostOf(u) {
  if (!u) return "";
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `http://${u}`).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

// Restore previously-known enrichment + WhatsApp status onto freshly loaded
// warehouse rows from the shared, cross-tenant caches, so a business enriched or
// WhatsApp-checked once shows that info on every later find. Mutates rows in place.
async function backfillFromCaches(rows, countryCode) {
  if (!rows || !rows.length) return;
  // Enrichment is domain-keyed; pull all matching rows in one query.
  const enrichMap = await db.getCachedEnrichmentMap(rows.map((r) => r.website || ""));
  // WhatsApp is phone-keyed. The per-lead check may have normalized with or
  // without a dialing code, so probe both the local and country-prefixed digits.
  const cc = waLib.dialingCode(countryCode) || "";
  const phoneKeys = (phone) => {
    const local = String(phone || "").replace(/\D/g, "");
    const intl = String(waLib.normalizePhone(phone, cc) || "").replace(/\D/g, "");
    return [...new Set([local, intl].filter((p) => p.length >= 7))];
  };
  const waMap = await db.getCachedWhatsappMap(rows.flatMap((r) => phoneKeys(r.phone)));

  for (const r of rows) {
    const ce = enrichMap.get(hostOf(r.website));
    if (ce) {
      if (!r.email) r.email = ce.email || "";
      if (!r.all_emails) r.all_emails = ce.all_emails || "";
      if (!r.contact_page) r.contact_page = ce.contact_page || "";
      if (!r.enrich_status) r.enrich_status = ce.enrich_status || "";
      let socials = {};
      if (r.socials) { try { socials = typeof r.socials === "string" ? JSON.parse(r.socials) : r.socials; } catch { socials = {}; } }
      for (const k of SOCIAL_KEYS) {
        if (!socials[k] && !r[k] && ce[k]) r[k] = ce[k];
      }
    }
    for (const key of phoneKeys(r.phone)) {
      const cw = waMap.get(key);
      if (cw && cw.status) { r.whatsapp_status = cw.status; r.whatsapp_id = cw.whatsapp_id || ""; break; }
    }
  }
}

// Escape a single CSV field value.
function csvField(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Build a CSV string from warehouse rows.
function buildCsv(rows) {
  const lines = [CSV_HEADERS.join(",")];
  for (const wh of rows) {
    // Expand socials: warehouse may store as JSON string or object.
    let socials = {};
    if (wh.socials) {
      if (typeof wh.socials === "string") {
        try { socials = JSON.parse(wh.socials); } catch { socials = {}; }
      } else if (typeof wh.socials === "object") {
        socials = wh.socials;
      }
    }

    const soc = (k) => socials[k] || wh[k] || "";
    const row = [
      csvField(wh.name),
      csvField(wh.category),
      csvField(wh.rating),
      csvField(wh.reviews),
      csvField(wh.website),
      csvField(wh.phone),
      csvField(wh.address),
      csvField(wh.plus_code || wh.plusCode || ""),
      csvField(wh.hours),
      csvField(wh.maps_url || wh.mapsUrl || ""),
      csvField(wh.lat != null ? wh.lat : ""),
      csvField(wh.lng != null ? wh.lng : ""),
      csvField(wh.email),
      csvField(wh.all_emails || wh.allEmails || ""),
      csvField(wh.contact_page || ""),
      csvField(soc("facebook")),
      csvField(soc("instagram")),
      csvField(soc("linkedin")),
      csvField(soc("twitter")),
      csvField(soc("youtube")),
      csvField(soc("tiktok")),
      csvField(soc("pinterest")),
      csvField(soc("whatsapp")),
      csvField(soc("telegram")),
      csvField(wh.owner_replied != null ? wh.owner_replied : ""),
      csvField(wh.owner_reply_count != null ? wh.owner_reply_count : ""),
      csvField(wh.whatsapp_status || ""),
      csvField(wh.whatsapp_id || ""),
      csvField(wh.enrich_status || ""),
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

// POST /api/projects/find
// Instantly loads leads from the warehouse into a project dir + DB.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  // Credit gate — one unified pool (1 credit per new lead). Free accounts may
  // spend their free grant; only block when truly out of credits.
  const entitlement = await billing.getEntitlement(userId);
  const avail = entitlement.unlimited ? Infinity : (entitlement.credits || 0);
  if (!entitlement.unlimited && avail <= 0) {
    return Response.json(
      { error: "You're out of credits. Choose a plan or top up to find more leads.", code: "no_credits" },
      { status: 402 }
    );
  }

  // Per-day limit gate (server-side, race-safe — can't be bypassed by replaying
  // requests over the network). Read the snapshot first so we can reject a fully
  // exhausted day before spending a search, then atomically count this search.
  const daily = await billing.getDailyUsage(userId);
  const resetIn = billing.formatResetIn(daily.resetInSeconds);
  if (!daily.searches.unlimited && daily.searches.remaining <= 0) {
    return Response.json(
      {
        error: `You've used all ${daily.searches.limit} of today's searches. Your limit resets in ${resetIn} (at midnight ${daily.tz}).`,
        code: "daily_search_limit",
        limit: daily.searches.limit, remaining: 0, resetAt: daily.resetAt, tz: daily.tz,
      },
      { status: 429 }
    );
  }
  if (!daily.leads.unlimited && daily.leads.remaining <= 0) {
    return Response.json(
      {
        error: `You've reached today's ${daily.leads.limit.toLocaleString()} lead limit. It resets in ${resetIn} (at midnight ${daily.tz}).`,
        code: "daily_lead_limit",
        limit: daily.leads.limit, remaining: 0, resetAt: daily.resetAt, tz: daily.tz,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { name, query, cityId, cityName, countryCode, countryName, service, minRating, maxRating, centerLat, centerLng, radiusKm, isUnknownKeyword } = body || {};

  if (!name) return Response.json({ error: "Project name is required" }, { status: 400 });

  // Atomically count this search against the daily cap. Race-safe: if many requests
  // fire at once, only those under the cap succeed.
  const searchCharge = await billing.consumeDailySearch(userId);
  if (!searchCharge.ok) {
    return Response.json(
      {
        error: `You've used all ${searchCharge.limit} of today's searches. Your limit resets in ${billing.formatResetIn(searchCharge.resetInSeconds)} (at midnight ${daily.tz}).`,
        code: "daily_search_limit",
        limit: searchCharge.limit, remaining: 0, resetAt: searchCharge.resetAt, tz: daily.tz,
      },
      { status: 429 }
    );
  }

  // Cap the request by the hard per-find limit (10k), the available credits (so the
  // post-insert charge always succeeds), AND the remaining daily lead allowance.
  const dailyLeadsLeft = daily.leads.unlimited ? Infinity : daily.leads.remaining;
  const max = Math.min(Math.max(1, Math.trunc(Number(body.max) || 30)), 10000, avail, dailyLeadsLeft);

  // Unique project name (appends random id if the slug already exists).
  const { name: projectName } = store.uniqueProjectName(name, userId);
  const dir = store.safeProjectDir(store.slugify(projectName), userId);

  // Short public id for support references (stable per project).
  const publicId = Math.random().toString(36).slice(2, 8).toUpperCase();

  // Reject if there is already a live runner for this project.
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return Response.json({ error: "Project is already running" }, { status: 409 });
  }

  // Write project metadata (same shape spawnRunner / writeMeta uses).
  store.writeMeta(dir, {
    name: projectName,
    slug: store.slugify(projectName),
    query: query || "",
    max: String(max),
    publicId,
    cityName: cityName || "",
    countryName: countryName || "",
    service: service || "",
    isUnknownKeyword: isUnknownKeyword ? "1" : "",
  });

  // Query the warehouse. A warehouse outage must return a clean error, not a 500.
  let total, rows;
  try {
    ({ total, rows } = await warehouse.queryLeads({
      cityId,
      countryCode,
      service,
      minRating,
      maxRating,
      centerLat,
      centerLng,
      radiusKm,
      limit: max,
    }));
  } catch (err) {
    // The search failed through no fault of the user — give back the daily search
    // we just counted so it doesn't burn their allowance.
    await billing.releaseDailySearch(userId).catch(() => {});
    store.writeState(dir, {
      running: false,
      queued: false,
      activePid: null,
      message: "Lead service is unavailable. Please try again shortly.",
    });
    return Response.json(
      { error: "Lead service is unavailable. Please try again shortly.", code: "warehouse_unavailable" },
      { status: 502 }
    );
  }

  // Restore previously-known enrichment + WhatsApp status from the shared caches.
  // Best-effort: a cache hiccup must never break the find itself.
  try {
    await backfillFromCaches(rows, countryCode);
  } catch {
    // ignore — leads still load without the cached extras.
  }

  // Write the raw CSV so loadStatus / the workspace UI can render leads instantly.
  const csvFile = path.join(dir, store.slugify(projectName) + ".csv");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(csvFile, buildCsv(rows), "utf8");

  // Upsert into the per-tenant leads DB (dedupes + consumes quota for inserts).
  const res = await db.upsertLeads(userId, rows.map(warehouse.toLeadRow));

  // Count the leads delivered this find against the daily lead cap (best-effort).
  await billing.addDailyLeads(userId, res.inserted).catch(() => {});

  // Mark project as finished (not running).
  store.writeState(dir, {
    running: false,
    queued: false,
    activePid: null,
    publicId,
    message: "Leads loaded",
    finishedAt: new Date().toISOString(),
    stages: {
      scrape: { status: "done" },
    },
    dbSync: {
      inserted: res.inserted,
      updated: res.updated,
      at: new Date().toISOString(),
    },
  });

  // Fallback: only when the warehouse has NOTHING for this area do we enqueue a
  // live Google Maps scrape (matches the admin "fall back ... when empty" mode).
  // When the warehouse already returned leads they're delivered instantly with no
  // queue — so the user never sees "waiting for a free slot" on a successful find.
  // (best-effort, never fails the response).
  try {
    const mode = await settings.getLeadSourceMode();
    if (mode === "warehouse_fallback" && rows.length === 0) {
      await queue.enqueue(userId, {
        name: projectName,
        query: query || "",
        max: String(max),
        stages: ["scrape"],
      });
    }
  } catch {
    // Fallback failure must not fail the find response.
  }

  return Response.json({
    ok: true,
    slug: store.slugify(projectName),
    name: projectName,
    total,
    inserted: res.inserted,
    updated: res.updated,
    status: store.loadStatus(projectName, userId),
  });
}
