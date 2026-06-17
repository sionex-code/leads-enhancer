import db from "../../../../web/lib/db.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Permanently delete the caller's selected leads. Body: { ids: number[] }.
// Scoped to the signed-in user, so it can only ever remove their own leads.
// Returns { ok, deleted }.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) return Response.json({ error: "No leads selected" }, { status: 400 });
  const deleted = await db.deleteLeadsByIds(userId, ids);
  return Response.json({ ok: true, deleted });
}
