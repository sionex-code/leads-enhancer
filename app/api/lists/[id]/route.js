import db from "../../../../web/lib/db.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const listId = Number(id);
  if (isNaN(listId)) return Response.json({ error: "Invalid list ID" }, { status: 400 });
  try {
    const ok = await db.deleteList(userId, listId);
    if (!ok) return Response.json({ error: "List not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const listId = Number(id);
  if (isNaN(listId)) return Response.json({ error: "Invalid list ID" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return Response.json({ error: "List name is required" }, { status: 400 });
  try {
    const list = await db.renameList(userId, listId, name);
    if (!list) return Response.json({ error: "List not found" }, { status: 404 });
    return Response.json({ list });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
