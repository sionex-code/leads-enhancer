import store from "../../../../../web/lib/store.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { slug } = await context.params;
  try {
    return Response.json(store.loadStatus(slug, userId));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}
