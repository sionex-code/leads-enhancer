import db from "../../../../web/lib/db.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  return Response.json({ lead });
}

export async function DELETE(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const deleted = await db.deleteLead(userId, id);
  return Response.json({ deleted });
}

export async function PATCH(request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const lead = await db.updateLeadWorkflow(userId, id, body);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  return Response.json({ lead });
}
