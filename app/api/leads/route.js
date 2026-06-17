import db from "../../../web/lib/db.cjs";
import siteReport from "../../../web/lib/site-report.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Sanitized domains that already have a generated report on disk, so each row can
// show a "Report ✓" badge. Reports are named `<sanitized-domain>-<ts>.html`; we
// strip the trailing `-<ts>.html` to recover the domain prefix (skipping the raw
// lighthouse dumps).
function reportedDomainSet() {
  const set = new Set();
  try {
    for (const r of siteReport.listReports()) {
      if (r.file.includes("-lighthouse")) continue;
      set.add(r.file.replace(/-\d+\.html$/, ""));
    }
  } catch {}
  return set;
}
const sanitizeDomain = (d) => String(d || "").replace(/[^a-z0-9.-]/gi, "_");

export async function GET(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country") || "";
  const [result, stats, projects, countries, cities, lists] = await Promise.all([
    db.queryLeads(userId, {
      search: searchParams.get("search") || "",
      hasEmail: searchParams.get("hasEmail") === "1",
      minScore: Number(searchParams.get("minScore") || 0),
      project: searchParams.get("project") || "",
      country,
      city: searchParams.get("city") || "",
      workflow: searchParams.get("workflow") || "",
      emailStatus: searchParams.get("emailStatus") || "",
      outreachStatus: searchParams.get("outreachStatus") || "",
      watchlist: searchParams.get("watchlist") === "1",
      contactList: searchParams.get("contactList") === "1",
      list: searchParams.get("list") || "",
      limit: Number(searchParams.get("limit") || 2000),
      offset: Number(searchParams.get("offset") || 0),
    }),
    db.statsLeads(userId),
    db.listProjectNames(userId),
    db.listCountries(userId),
    db.listCities(userId, country),
    db.listLists(userId),
  ]);
  // Tag each row with whether a report already exists for its domain.
  const reported = reportedDomainSet();
  const rows = (result.rows || []).map((row) => ({
    ...row,
    has_report: row.domain ? reported.has(sanitizeDomain(row.domain)) : false,
  }));
  return Response.json({ ...result, rows, stats, projects, countries, cities, lists });
}

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));

  // Bulk mode: save many leads in one round-trip and return their ids aligned to
  // input order (used by the dashboard's bulk add-to-list / audit / report so the
  // selected rows are persisted in a single request instead of one POST per lead).
  if (Array.isArray(body.leads)) {
    try {
      const saved = await db.bulkSaveLeads(userId, body.leads);
      return Response.json({ leads: saved });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  const rawWebsite = String(body.website || "").trim();
  const website = rawWebsite && !/^https?:\/\//i.test(rawWebsite) ? `https://${rawWebsite}` : rawWebsite;
  const phone = String(body.phone || "").trim();
  const name = String(body.name || "").trim() || db.hostOf(website) || website || phone;
  if (!website && !phone && !name) {
    return Response.json({ error: "Add a website, phone, or lead name first" }, { status: 400 });
  }

  try {
    const lead = await db.createOrUpdateLead(userId, {
      ...body,
      name,
      website,
      phone,
      notes: body.notes,
      watchlist: body.watchlist,
      contact_list: body.contact_list ?? body.contactList,
    });
    return Response.json({ lead });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
