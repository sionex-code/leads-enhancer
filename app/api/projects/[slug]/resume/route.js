import store from "../../../../../web/lib/store.cjs";

export async function POST(_request, context) {
  const { slug } = await context.params;
  const status = store.loadStatus(slug);
  if (status.state.activePid && store.processAlive(status.state.activePid)) {
    return Response.json({ error: "Project is already running" }, { status: 409 });
  }
  const result = store.spawnRunner({
    name: status.name,
    query: status.query,
    max: status.max,
    stages: ["resume"],
    device: "all",
    enrichConcurrency: 16,
    auditConcurrency: 2,
  });
  return Response.json(result);
}
