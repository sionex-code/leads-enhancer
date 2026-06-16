import store from "../../../../../web/lib/store.cjs";
import queue from "../../../../../web/lib/queue.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { slug } = await context.params;
  const status = store.loadStatus(slug, userId);
  if (status.state.activePid && store.processAlive(status.state.activePid)) {
    return Response.json({ error: "Project is already running" }, { status: 409 });
  }
  const result = await queue.enqueue(userId, {
    name: status.name,
    query: status.query,
    max: status.max,
    stages: ["resume"],
    device: "all",
    enrichConcurrency: 16,
    auditConcurrency: 2,
  });
  return Response.json({ ok: true, queued: true, ...result });
}
