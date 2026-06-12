import db from "../../../../web/lib/db.cjs";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { id } = await context.params;
  const lead = db.getLead(id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  return Response.json({ lead });
}

export async function DELETE(_request, context) {
  const { id } = await context.params;
  const deleted = db.deleteLead(id);
  return Response.json({ deleted });
}

export async function PATCH(request, context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const lead = db.updateLeadWorkflow(id, body);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  return Response.json({ lead });
}
