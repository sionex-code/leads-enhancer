import store from "../../../../web/lib/store.cjs";

export async function DELETE(_request, context) {
  const { slug } = await context.params;
  const dir = store.safeProjectDir(slug);
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return Response.json({ error: "Stop the project before deleting it" }, { status: 409 });
  }
  store.deleteProject(slug);
  return Response.json({ ok: true });
}
