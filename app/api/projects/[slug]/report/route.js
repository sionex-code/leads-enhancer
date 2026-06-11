import fs from "fs";
import path from "path";
import store from "../../../../../web/lib/store.cjs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  const status = store.loadStatus(slug);
  const file = status.files.report;
  if (!file || !fs.existsSync(file)) {
    return Response.json({ error: "Report not found" }, { status: 404 });
  }
  const body = fs.readFileSync(file, "utf8");
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${path.basename(file)}"`,
    },
  });
}

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
    stages: ["report"],
    device: "all",
    enrichConcurrency: 16,
    auditConcurrency: 2,
  });
  return Response.json(result);
}
