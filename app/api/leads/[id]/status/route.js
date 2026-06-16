import db from "../../../../../web/lib/db.cjs";
import { checkStatus } from "../../../../../web/lib/http-status.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Fast website status check for one lead (no browser): records the HTTP status
// code so the leads table can show a 200 / 404 / 500 / unreachable pill.
export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.website) return Response.json({ error: "This lead has no website" }, { status: 400 });

  const r = await checkStatus(lead.website);
  const updated = await db.updateLeadScan(userId, id, {
    http_status: r.status || null,
    http_status_text: r.statusText || null,
    http_checked_at: new Date().toISOString(),
  });
  return Response.json({ lead: updated });
}
