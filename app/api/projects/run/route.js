import store from "../../../../web/lib/store.cjs";
import queue from "../../../../web/lib/queue.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  // Credit gate — one unified pool (1 credit per new lead). Free accounts may
  // spend their free grant; only block when truly out of credits.
  const entitlement = await billing.getEntitlement(userId);
  if (!entitlement.unlimited && (entitlement.credits || 0) <= 0) {
    return Response.json({ error: "You're out of credits. Choose a plan or top up to find more leads.", code: "no_credits" }, { status: 402 });
  }

  const body = await request.json();
  if (!body.name) return Response.json({ error: "Project name is required" }, { status: 400 });

  // A new run whose name already exists becomes its own project (random 5-char
  // id appended) instead of merging into / colliding with the existing one.
  const { name: projectName } = store.uniqueProjectName(body.name, userId);

  // Reject if this user already has this project running.
  const dir = store.safeProjectDir(store.slugify(projectName), userId);
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return Response.json({ error: "Project is already running" }, { status: 409 });
  }

  const stages = Array.isArray(body.stages) && body.stages.length ? body.stages : ["scrape", "enrich", "whatsapp", "audit", "report"];
  const result = await queue.enqueue(userId, {
    name: projectName,
    query: body.query || "",
    max: body.max || "",
    stages,
    device: body.device || "all",
    enrichConcurrency: body.enrichConcurrency || 16,
    enrichEngine: body.enrichEngine === "crawlee" ? "crawlee" : "patchright",
    auditConcurrency: body.auditConcurrency || 2,
    headless: !!body.headless,
    blockCanvas: !!body.blockCanvas,
    blockImages: body.blockImages !== false,
    network: body.network !== false,
  });
  return Response.json({ ok: true, queued: true, ...result });
}
