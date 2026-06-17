import store from "../../../../web/lib/store.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function DELETE(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { slug } = await context.params;
  const dir = store.safeProjectDir(slug, userId);
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return Response.json({ error: "Stop the project before deleting it" }, { status: 409 });
  }
  store.deleteProject(slug, userId);
  return Response.json({ ok: true });
}

export async function PATCH(request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = store.setProjectWatchlist(slug, !!body.watchlist, userId);
  return Response.json(result);
}
