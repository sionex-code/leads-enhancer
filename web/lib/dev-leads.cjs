// Dev-only leads source. Reads the real CSVs sitting in the dev tenant's project
// folders and shapes them like rows out of the `leads` table, so the leads table
// UI can be worked on locally without a reachable Postgres.
//
// Only ever reached when DEV_AUTH_ENABLED is true (see web/lib/dev-auth.js) -
// nothing here is imported into a production code path.
const path = require("path");
const store = require("./store.cjs");
const { DEV_USER_ID } = require("./dev-user.cjs");

// A lead's identity for dedupe/lookup, mirroring the real data layer: the site's
// domain when there is one, otherwise the digits of the phone, otherwise the name.
function domainOf(website) {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// "plumber in Sydney NSW Australia" -> { city: "Sydney NSW", country: "Australia" }.
// Best effort only; the real rows get these from the scrape parameters.
function placeFromQuery(query) {
  const m = String(query || "").match(/\bin\s+(.+)$/i);
  if (!m) return { city: "", country: "" };
  const parts = m[1].split(/\s+/);
  const country = parts.length > 1 ? parts[parts.length - 1] : "";
  const city = parts.slice(0, -1).join(" ") || m[1];
  return { city, country };
}

const num = (v) => {
  const n = Number(String(v || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function rowsForProject(project, startId) {
  const dir = path.join(
    process.env.GMAPS_DATA_DIR || process.cwd(),
    "tenants",
    DEV_USER_ID,
    "output",
    "projects",
    project.slug
  );
  // Enriched output carries emails and socials, so prefer it when the project has
  // been through enrichment; fall back to the raw scrape otherwise.
  const file = store.latestEnrichedCsv(dir) || store.latestRawCsv(dir);
  const { city, country } = placeFromQuery(project.query);
  const stamp = project.updatedAt || new Date().toISOString();

  return store.readCsvObjects(file).map((r, i) => {
    const website = r.website || "";
    const domain = domainOf(website);
    return {
      id: startId + i,
      user_id: DEV_USER_ID,
      dedup_key: domain || r.phone || r.name || `dev-${startId + i}`,
      name: r.name || "",
      category: r.category || "",
      rating: r.rating || "",
      reviews: r.reviews || "",
      website,
      domain,
      phone: r.phone || "",
      address: r.address || "",
      city,
      country,
      plus_code: r.plusCode || "",
      hours: r.hours || "",
      maps_url: r.mapsUrl || "",
      image_urls: r.imageUrls || "",
      email: r.email || "",
      all_emails: r.allEmails || "",
      contact_page: r.contactPage || "",
      facebook: r.facebook || "",
      instagram: r.instagram || "",
      linkedin: r.linkedin || "",
      twitter: r.twitter || "",
      youtube: "",
      tiktok: "",
      pinterest: "",
      whatsapp: "",
      telegram: "",
      enrich_status: r.enrichStatus || "",
      whatsapp_status: "",
      whatsapp_id: "",
      desktop_performance: null,
      desktop_seo: null,
      desktop_accessibility: null,
      desktop_best_practices: null,
      mobile_performance: null,
      mobile_seo: null,
      mobile_accessibility: null,
      mobile_best_practices: null,
      http_status: null,
      http_status_text: "",
      http_checked_at: null,
      chatbot: "",
      chatbot_vendors: "",
      chatbot_method: "",
      chatbot_checked_at: null,
      domain_rating: null,
      domain_rating_checked_at: null,
      project: project.name,
      query: project.query || "",
      lat: num(r.lat),
      lng: num(r.lng),
      owner_replied: 0,
      owner_reply_count: 0,
      watchlist: 0,
      contact_list: 0,
      email_status: "unset",
      outreach_status: "new",
      notes: "",
      last_contacted_at: null,
      message_sent_at: null,
      completed_at: null,
      first_seen: stamp,
      last_updated: stamp,
      list_count: 0,
      has_report: false,
    };
  });
}

// Every dev lead, newest project first. Rebuilt per call - the CSVs are small and
// this keeps edits to them visible on reload without a restart.
function allLeads() {
  let id = 1;
  const out = [];
  for (const project of store.listProjects(DEV_USER_ID)) {
    const rows = rowsForProject(project, id);
    id += rows.length;
    out.push(...rows);
  }
  return out;
}

const has = (v) => Boolean(String(v || "").trim());

// The subset of query filters the leads UI actually drives. Anything not listed
// here is ignored rather than faked, so the table never shows a filter as applied
// when it isn't.
function filterLeads(rows, opts = {}) {
  const search = String(opts.search || "").trim().toLowerCase();
  return rows.filter((r) => {
    if (search) {
      const hay = [r.name, r.domain, r.phone, r.email, r.category, r.address]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (opts.project && r.project !== opts.project) return false;
    if (opts.country && r.country !== opts.country) return false;
    if (opts.city && r.city !== opts.city) return false;
    if (opts.hasEmail === "1" && !has(r.email)) return false;
    if (opts.hasEmail === "0" && has(r.email)) return false;
    if (opts.hasWebsite === "1" && !has(r.website)) return false;
    if (opts.hasWebsite === "0" && has(r.website)) return false;
    if (opts.watchlist && !r.watchlist) return false;
    if (opts.contactList && !r.contact_list) return false;
    return true;
  });
}

function statsFor(rows) {
  const count = (fn) => rows.filter(fn).length;
  return {
    total: rows.length,
    withEmail: count((r) => has(r.email)),
    withWhatsapp: count((r) => has(r.whatsapp) || has(r.whatsapp_status)),
    withWebsite: count((r) => has(r.website)),
    audited: count((r) => r.desktop_performance != null || r.mobile_performance != null),
    projects: new Set(rows.map((r) => r.project).filter(Boolean)).size,
    watchlist: count((r) => r.watchlist),
    contactList: count((r) => r.contact_list),
    emailReady: count((r) => r.email_status === "send"),
    queued: count((r) => r.outreach_status === "queued"),
    sent: count((r) => r.outreach_status === "sent"),
    completed: count((r) => r.outreach_status === "complete"),
  };
}

const uniq = (vals) => [...new Set(vals.filter(Boolean))].sort();

// The whole /api/leads GET body, built from the CSVs.
function leadsPayload(opts = {}) {
  const all = allLeads();
  const matched = filterLeads(all, opts);
  const offset = Number(opts.offset || 0);
  const limit = Number(opts.limit || 2000);
  return {
    total: matched.length,
    rows: matched.slice(offset, offset + limit),
    stats: statsFor(all),
    projects: uniq(all.map((r) => r.project)),
    countries: uniq(all.map((r) => r.country)).map((country) => ({ country })),
    cities: uniq(
      all.filter((r) => !opts.country || r.country === opts.country).map((r) => r.city)
    ).map((city) => ({ city })),
    lists: [],
  };
}

module.exports = { allLeads, filterLeads, leadsPayload, statsFor };
