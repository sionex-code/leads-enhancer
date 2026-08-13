import path from "path";
import fs from "fs";
import store from "../../../../web/lib/store.cjs";
import db from "../../../../web/lib/db.cjs";
import warehouse from "../../../../web/lib/warehouse.cjs";
import geo from "../../../../web/lib/geo-resolve.cjs";
import publicSearches from "../../../../web/lib/public-searches.cjs";
import billing from "../../../../web/lib/billing.cjs";
import settings from "../../../../web/lib/settings.cjs";
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

// Nominatim's display_name runs coarse-to-fine and always ends with the
// country: "Islamabad, Zone 1, Islamabad Capital Territory, 44000, Pakistan".
function countryFromDisplay(display) {
  const parts = String(display || "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

// The keyword half of "<what> in <where>". Used when a live search could not be
// resolved to a place: we still know what was being looked for, even if we can't
// honestly say where it landed, and the typed text beats the Service dropdown —
// which for a live search describes a different query altogether.
function keywordFromQuery(text) {
  const parts = String(text || "").trim().split(/(?:^|\s)in\s/i);
  return (parts[0] || "").trim();
}

// The area the user actually asked for, in whichever shape the search used.
//
// Persisted because the live path has no other way to hold itself to it. The
// extension converts centre+radius into a *square* bounding box and then keeps
// anything inside it plus a fixed 0.05 degree margin, so a 5 km search accepts
// businesses ~14 km away and a 1 km search accepts them ~9 km away. Google Maps
// answers the query text, not our radius, so without a final check the slider
// was decoration on every live search.
function searchAreaMeta(area, dropdown) {
  const blank = { searchCenterLat: "", searchCenterLng: "", searchRadiusKm: "", searchBbox: "" };
  const radius = Number(dropdown.radiusKm);
  // An area the form resolved is a point, and the radius slider still applies.
  if (area && area.fromClient && Number.isFinite(area.lat) && Number.isFinite(area.lng)) {
    return { ...blank, searchCenterLat: String(area.lat), searchCenterLng: String(area.lng), searchRadiusKm: Number.isFinite(radius) ? String(radius) : "" };
  }
  // An area resolved here is an administrative region: its bbox *is* the area,
  // and there is no radius to honour.
  if (area && area.bbox) return { ...blank, searchBbox: JSON.stringify(area.bbox) };
  const lat = Number(dropdown.centerLat);
  const lng = Number(dropdown.centerLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius)) {
    return { ...blank, searchCenterLat: String(lat), searchCenterLng: String(lng), searchRadiusKm: String(radius) };
  }
  return blank;
}

// Name a project after the search that actually ran: "Islamabad Restaurants
// Leads". Built from the resolved keyword and place rather than the dropdowns,
// which for a typed query describe somewhere else entirely.
function nameFromArea(area, keywordOverride) {
  const titleCase = (s) =>
    String(s || "").trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const place = titleCase(area.shortName);
  const keyword = titleCase(keywordOverride || area.keyword);
  // Don't repeat the place when the keyword already contains it ("Gujrat
  // Plumber" in Gujrat) — that would read "Gujrat Gujrat Plumber Leads".
  const kw = place && keyword.toLowerCase().includes(place.toLowerCase()) ? "" : keyword;
  return `${place} ${kw} Leads`.replace(/\s+/g, " ").trim().slice(0, 80);
}

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
  const { name, query, cityId, cityName, countryCode, countryName, service, minRating, maxRating, centerLat, centerLng, radiusKm, isUnknownKeyword, isCustomQuery } = body || {};

  // Where the leads come from. "warehouse" serves what we already have (instant);
  // "live" skips the warehouse entirely and scrapes Google Maps in the user's
  // browser via the extension. This is an explicit choice rather than only an
  // automatic fallback: the warehouse having *some* rows for an area doesn't mean
  // it has the ones the user wants, and previously any non-empty result meant the
  // extension never ran.
  const source = body?.source === "live" ? "live" : "warehouse";

  // The warehouse resolves a search entirely from the structured fields —
  // `services.name`, city id, country — and never looks at `query`. So any typed
  // text that differs from those selections cannot be answered from stored leads:
  // "Gujrat Plumber" against a city dropdown set to Uppsala returns Uppsala
  // plumbers, which is both wrong and non-empty, so the live fallback never fires
  // either. Custom text has to go live.
  const mustGoLive = source === "live" || !!isCustomQuery || !!isUnknownKeyword;

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

  // Resolve typed text to a real place BEFORE naming the project. The client
  // can only name a search from the dropdowns it can see, so a typed search got
  // labelled with whatever city happened to be selected — "Copenhagen, Denmark
  // Leads" sitting on top of 109 Islamabad businesses. Only this side knows
  // where the search actually went, so it has to supply the name too.
  let area = null;
  // Any live run searches the query text, so any live run needs the text
  // resolved. Requiring isCustomQuery too meant a search forced live by an
  // unrecognised keyword skipped resolution entirely and then got labelled from
  // the dropdowns, which is how "Coworking space · Adelaide · Australia" ended
  // up sitting on ten Islamabad businesses.
  if (mustGoLive && query) {
    // The form already resolved this text to show the user where the pin was
    // going. Reusing its answer means the search runs exactly where the map
    // said it would, and saves a second Nominatim call for the same string.
    // Everything is re-derived from it here rather than trusted wholesale: the
    // client only supplies coordinates and labels, never a bounding box.
    const pre = body.resolvedArea;
    if (pre && Number.isFinite(Number(pre.lat)) && Number.isFinite(Number(pre.lng))) {
      area = {
        keyword: String(pre.keyword || "").trim(),
        shortName: String(pre.place || "").trim(),
        display: String(pre.display || "").trim(),
        countryCode: String(pre.countryCode || "").trim().toUpperCase(),
        countryName: String(pre.countryName || "").trim(),
        lat: Number(pre.lat),
        lng: Number(pre.lng),
        // No bbox on purpose. A geocoded bounding box covers the whole
        // administrative area and silently ignores the radius slider, so a
        // 5 km search of "restaurants in London" would grid all of Greater
        // London. Centre plus the user's radius respects both inputs.
        fromClient: true,
      };
    } else {
      // Only let the resolver treat the ENTIRE query as a place when it does
      // not already look like a recognised service — the same signal that
      // decided isUnknownKeyword above. "spa" is also a town in Belgium, and
      // without this, a bare service name a live search silently relocated
      // itself off the user's own map circle and onto whatever real place
      // shared its name.
      area = await geo.resolveArea(query, { allowWholeQueryFallback: !!isUnknownKeyword }).catch(() => null);
    }
  }

  // When the query was nothing but a place name, the keyword comes back empty —
  // fall back to the service the user already had selected.
  const areaKeyword = area ? (area.keyword || service || "").trim() : "";

  // Unique project name (appends random id if the slug already exists).
  const requestedName = area ? nameFromArea(area, areaKeyword) : name;
  const { name: projectName } = store.uniqueProjectName(requestedName, userId);
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
    // Where the search actually went.
    //
    // A warehouse lookup searches *by* cityId/countryCode, so its dropdowns are
    // the truth by definition. A live scrape searches the query text, and the
    // dropdowns are then just whatever the form happened to be showing — a
    // different city, usually a different country. Falling back to them when
    // resolution failed is what produced project headers reading "Adelaide,
    // Australia" over Islamabad leads, and those labels flow on into the
    // directory. An empty crumb is honest; a confident wrong one is not.
    cityName: area ? area.shortName : (mustGoLive ? "" : (cityName || "")),
    countryName: area
      ? (area.countryName || countryFromDisplay(area.display))
      : (mustGoLive ? "" : (countryName || "")),
    service: area ? areaKeyword : (mustGoLive ? keywordFromQuery(query) : (service || "")),
    // Needed by /ingest to publish a live scrape into the shared warehouse:
    // the country has to be an ISO code to match the warehouse's country list,
    // and the coordinates place a city the catalog has never seen before.
    // Same rule as cityName/countryName above, and it matters more here:
    // publishToDirectory keys the public record on this code, and ingest can
    // later fill in a city and country name from the scraped addresses. If the
    // code were still the dropdown's, that correction would publish Islamabad
    // leads under Australia. Empty means the search stays private, which is the
    // right outcome when we can't say where it went.
    countryCode: area ? (area.countryCode || "") : (mustGoLive ? "" : String(countryCode || "").toUpperCase()),
    cityId: area ? "" : (cityId ?? ""),
    areaLat: area ? String(area.lat ?? "") : "",
    areaLng: area ? String(area.lng ?? "") : "",
    // What /ingest holds a live scrape to. See searchAreaMeta.
    ...searchAreaMeta(area, { centerLat, centerLng, radiusKm }),
    // This flag makes the UI synthesise a label from cityName/countryName
    // instead of showing the real one. That is only appropriate when we could
    // not work out what was searched — which is no longer the case here.
    isUnknownKeyword: isUnknownKeyword && !area ? "1" : "",
  });

  // Explicit live search: don't touch the warehouse at all. The client drives the
  // extension and POSTs the rows to /ingest, which is what actually stores them
  // and charges credits — so there is nothing to insert here.
  if (mustGoLive) {
    store.writeState(dir, {
      running: false,
      queued: false,
      activePid: null,
      publicId,
      message: "Searching the map in your browser…",
    });

    // `area` was resolved above, before the project was named. Google answers
    // the *text* ("Gujrat Plumber" returns Pakistani plumbers however the
    // dropdowns are set), but the grid engine only keeps results inside the box
    // it was handed — hand it the dropdown's box and every result is discarded
    // as out-of-area, scoring a full page of leads as zero.
    return Response.json({
      ok: true,
      slug: store.slugify(projectName),
      name: projectName,
      total: 0,
      inserted: 0,
      updated: 0,
      needsLive: true,
      source: "live",
      liveParams: {
        // Search the keyword alone once the place name is carried by the bbox;
        // leaving it in ("Plumber" vs "Gujrat Plumber") narrows Maps to
        // businesses with the place in their name.
        query: area ? (areaKeyword || query || "") : (query || ""),
        // These label the run for the client. They described the dropdowns,
        // which for a live search point somewhere the scrape is not going, so
        // the extension reported progress against the wrong city. Same rule as
        // the metadata above: the resolved area, else the query text, else
        // nothing.
        service: area ? areaKeyword : keywordFromQuery(query),
        cityName: area ? area.shortName : "",
        countryCode: area ? (area.countryCode || "") : "",
        // The warehouse path applies these in SQL. The live path has to carry
        // them to the client and apply them to what the extension returns,
        // otherwise picking a rating band silently does nothing for any search
        // that goes live — which is every custom keyword.
        minRating,
        maxRating,
        // A resolved bbox wins; otherwise fall back to the dropdown's centre,
        // which is correct whenever the query wasn't custom text.
        // An area the form resolved searches its centre at the radius the user
        // chose. An area resolved here has no radius to honour, so its bbox is
        // the best description of it. Neither case falls back to the dropdown
        // centre, which describes somewhere the search is not going.
        ...(area && area.fromClient
          ? { centerLat: area.lat, centerLng: area.lng, radiusKm, areaLabel: area.display || area.shortName }
          : area
            ? { bbox: area.bbox, latStep: area.latStep, lngStep: area.lngStep, areaLabel: area.display }
            : { centerLat, centerLng, radiusKm }),
        max,
      },
      status: store.loadStatus(projectName, userId),
    });
  }

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

  // Fallback: only when the warehouse has NOTHING for this area is a live
  // Google Maps scrape needed.
  //
  // That scrape now runs in the user's browser via the extension, which is why
  // this no longer enqueues a server-side job: live scraping was the single
  // biggest source of CPU/bandwidth load on the VPS, and it scaled with user
  // count. The client sees `needsLive` and drives the extension, then POSTs the
  // rows to /api/projects/:slug/ingest. `liveParams` echoes back what the
  // extension needs so the client doesn't have to reconstruct it.
  let needsLive = false;
  if (rows.length === 0) {
    try {
      const mode = await settings.getLeadSourceMode();
      needsLive = mode === "warehouse_fallback";
    } catch {
      // Settings hiccup: don't offer a live scrape we can't reason about.
      needsLive = false;
    }
    if (needsLive) {
      store.writeState(dir, {
        running: false,
        queued: false,
        activePid: null,
        publicId,
        message: "Searching the map in your browser…",
      });
    }
  }

  // Publish the *shape* of this search to the public directory: city, service,
  // country and how many rows the warehouse holds. Deliberately not recorded
  // for live/custom searches — those carry free-typed text belonging to the
  // person who typed it, and their leads live in that user's project rather
  // than the shared warehouse, so there would be nothing public to show.
  if (rows.length > 0 && cityName && service) {
    // Attribution is anonymised in the lib (first name + last initial) — these
    // rows land on a public, indexed page.
    const searcher = (await publicSearches.labelForUser(userId)) || null;
    await publicSearches.record({
      cityId, cityName, countryCode, countryName, service,
      leadCount: total, searcher,
    });
  }

  return Response.json({
    ok: true,
    slug: store.slugify(projectName),
    name: projectName,
    total,
    inserted: res.inserted,
    updated: res.updated,
    needsLive,
    source: "warehouse",
    liveParams: needsLive
      ? {
          query: query || "",
          service: service || "",
          cityName: cityName || "",
          countryCode: countryCode || "",
          centerLat, centerLng, radiusKm,
          max,
        }
      : null,
    status: store.loadStatus(projectName, userId),
  });
}
