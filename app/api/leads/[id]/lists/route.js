import db from "../../../../../web/lib/db.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Which named lists this lead currently belongs to.
export async function GET(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const listIds = await db.getLeadListIds(userId, id);
  return Response.json({ listIds });
}

// Replace this lead's list membership with exactly `listIds`. Returns the updated
// lead so the table can refresh (contact_list is kept in sync with membership).
export async function PUT(request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const listIds = Array.isArray(body.listIds) ? body.listIds : [];
  const saved = await db.setLeadLists(userId, id, listIds);
  const updated = await db.getLead(userId, id);
  return Response.json({ listIds: saved, lead: updated });
}
