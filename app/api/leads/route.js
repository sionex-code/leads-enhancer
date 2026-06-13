import db from "../../../web/lib/db.cjs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = db.queryLeads({
    search: searchParams.get("search") || "",
    hasEmail: searchParams.get("hasEmail") === "1",
    minScore: Number(searchParams.get("minScore") || 0),
    project: searchParams.get("project") || "",
    workflow: searchParams.get("workflow") || "",
    emailStatus: searchParams.get("emailStatus") || "",
    outreachStatus: searchParams.get("outreachStatus") || "",
    watchlist: searchParams.get("watchlist") === "1",
    contactList: searchParams.get("contactList") === "1",
    limit: Number(searchParams.get("limit") || 2000),
    offset: Number(searchParams.get("offset") || 0),
  });
  return Response.json({ ...result, stats: db.statsLeads(), projects: db.listProjectNames() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const rawWebsite = String(body.website || "").trim();
  const website = rawWebsite && !/^https?:\/\//i.test(rawWebsite) ? `https://${rawWebsite}` : rawWebsite;
  const phone = String(body.phone || "").trim();
  const name = String(body.name || "").trim() || db.hostOf(website) || website || phone;
  if (!website && !phone && !name) {
    return Response.json({ error: "Add a website, phone, or lead name first" }, { status: 400 });
  }

  try {
    const lead = db.createOrUpdateLead({
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
