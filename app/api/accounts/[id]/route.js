import db from "../../../../web/lib/db.cjs";

export async function PATCH(request, context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  db.setAccountEnabled(id, !!body.enabled);
  return Response.json({ ok: true });
}

export async function DELETE(_request, context) {
  const { id } = await context.params;
  db.deleteAccount(id);
  return Response.json({ ok: true });
}
