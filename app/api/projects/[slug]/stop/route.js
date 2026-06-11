import store from "../../../../../web/lib/store.cjs";

export async function POST(_request, context) {
  const { slug } = await context.params;
  const dir = store.safeProjectDir(slug);
  const state = store.readState(dir);
  if (state.activePid) store.killTree(state.activePid);
  store.writeState(dir, {
    running: false,
    activePid: null,
    message: "Stopped",
    stoppedAt: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}
