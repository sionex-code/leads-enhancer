import store from "../../../../../web/lib/store.cjs";

export async function POST(_request, context) {
  const { slug } = await context.params;
  const dir = store.safeProjectDir(slug);
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) store.killTree(state.activePid);
  const result = store.cleanupBrowser(dir);
  store.writeState(dir, {
    running: false,
    activePid: null,
    message: "Project browser profile cleaned",
  });
  return Response.json({ ok: true, ...result });
}
