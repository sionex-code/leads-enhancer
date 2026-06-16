import store from "../../../../web/lib/store.cjs";
import queue from "../../../../web/lib/queue.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  // Gate behind an active membership + remaining lead quota.
  const entitlement = await billing.getEntitlement(userId);
  if (!entitlement.active) {
    return Response.json({ error: "You need an active plan to find leads. Choose a plan to continue.", code: "no_plan" }, { status: 402 });
  }
  if (entitlement.remaining !== null && entitlement.remaining <= 0) {
    return Response.json({ error: "Monthly lead quota reached. Upgrade your plan to find more leads.", code: "quota_exceeded" }, { status: 402 });
  }

  const body = await request.json();
  if (!body.name) return Response.json({ error: "Project name is required" }, { status: 400 });

  // Reject if this user already has this project running.
  const dir = store.safeProjectDir(store.slugify(body.name), userId);
  const state = store.readState(dir);
  if (state.activePid && store.processAlive(state.activePid)) {
    return Response.json({ error: "Project is already running" }, { status: 409 });
  }

  const stages = Array.isArray(body.stages) && body.stages.length ? body.stages : ["scrape", "enrich", "whatsapp", "audit", "report"];
  const result = await queue.enqueue(userId, {
    name: body.name,
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
