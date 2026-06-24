import db from "../../../../web/lib/db.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Export the signed-in user's leads as CSV. Honors the same filters as the leads
// list (`/api/leads`) so the download matches what's on screen, and an optional
// `ids` (comma list) to export only the currently selected rows.
export async function GET(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids") || "";
  const ids = idsParam
    ? idsParam.split(",").map((s) => Number(s.trim())).filter(Number.isFinite)
    : null;

  const columnsParam = searchParams.get("columns") || "";
  const columns = columnsParam
    ? columnsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null; // null = export all (legacy default)

  const csv = await db.exportCsv(userId, {
    search: searchParams.get("search") || "",
    hasEmail: searchParams.get("hasEmail") || "",
    hasWhatsapp: searchParams.get("hasWhatsapp") || "",
    hasWebsite: searchParams.get("hasWebsite") || "",
    httpStatus: searchParams.get("httpStatus") || "",
    minScore: Number(searchParams.get("minScore") || 0),
    project: searchParams.get("project") || "",
    country: searchParams.get("country") || "",
    city: searchParams.get("city") || "",
    workflow: searchParams.get("workflow") || "",
    emailStatus: searchParams.get("emailStatus") || "",
    outreachStatus: searchParams.get("outreachStatus") || "",
    watchlist: searchParams.get("watchlist") === "1",
    contactList: searchParams.get("contactList") === "1",
    list: searchParams.get("list") || "",
    ids,
    columns,
  });

  const filename = ids && ids.length ? "leads-selected.csv" : "leads-filtered.csv";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
