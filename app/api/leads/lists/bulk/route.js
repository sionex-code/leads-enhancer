import db from "../../../../../web/lib/db.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Add the selected leads to one or more lists in a single request.
// Body: { ids:[], listIds?:[], listId?, newListName? }. Either pick existing
// list(s) or pass newListName to create one on the fly.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) return Response.json({ error: "No leads selected" }, { status: 400 });

  // Accept a single listId (back-compat) or a listIds array.
  const listIds = new Set(
    [...(Array.isArray(body.listIds) ? body.listIds : []), body.listId]
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
  if (body.newListName) {
    const list = await db.createList(userId, body.newListName);
    if (list?.id) listIds.add(list.id);
  }
  if (!listIds.size) return Response.json({ error: "Pick or name a list" }, { status: 400 });

  try {
    let added = 0;
    for (const listId of listIds) added = Math.max(added, await db.addLeadsToList(userId, listId, ids));
    return Response.json({ ok: true, listIds: [...listIds], added });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
