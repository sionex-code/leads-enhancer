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
