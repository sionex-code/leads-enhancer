import db from "../../../../../web/lib/db.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Add the selected leads to a list. Body: { ids:[], listId?, newListName? }.
// Either pick an existing listId or pass newListName to create one on the fly.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) return Response.json({ error: "No leads selected" }, { status: 400 });

  let listId = body.listId ? Number(body.listId) : null;
  if (!listId && body.newListName) {
    const list = await db.createList(userId, body.newListName);
    listId = list.id;
  }
  if (!listId) return Response.json({ error: "Pick or name a list" }, { status: 400 });

  try {
    const added = await db.addLeadsToList(userId, listId, ids);
    return Response.json({ ok: true, listId, added });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
