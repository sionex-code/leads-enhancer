import db from "../../../web/lib/db.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// The signed-in user's named lists, each with its member count.
export async function GET() {
  const { userId, response } = await requireUser();
  if (response) return response;
  const lists = await db.listLists(userId);
  return Response.json({ lists });
}

// Create a named list (idempotent on name, case-insensitive).
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return Response.json({ error: "List name is required" }, { status: 400 });
  try {
    const list = await db.createList(userId, name);
    return Response.json({ list });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
