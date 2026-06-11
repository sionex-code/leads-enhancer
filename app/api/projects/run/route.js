import store from "../../../../web/lib/store.cjs";

export async function POST(request) {
  const body = await request.json();
  if (!body.name) return Response.json({ error: "Project name is required" }, { status: 400 });
  const slug = store.slugify(body.name);
  const dir = store.safeProjectDir(slug);
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return Response.json({ error: "Project is already running" }, { status: 409 });
  }
  const stages = Array.isArray(body.stages) && body.stages.length ? body.stages : ["scrape", "enrich", "whatsapp", "audit", "report"];
  const result = store.spawnRunner({
    name: body.name,
    query: body.query || "",
    max: body.max || "",
    stages,
    device: body.device || "all",
    enrichConcurrency: body.enrichConcurrency || 16,
    auditConcurrency: body.auditConcurrency || 2,
    headless: !!body.headless,
    blockCanvas: !!body.blockCanvas,
    blockImages: body.blockImages !== false, // images blocked unless explicitly allowed
    network: body.network !== false, // fast network capture unless explicitly disabled
  });
  return Response.json(result);
}
