import store from "../../../../web/lib/store.cjs";
import queue from "../../../../web/lib/queue.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  // Gate behind an active membership + remaining credits (1 credit per lead).
  const entitlement = await billing.getEntitlement(userId);
  if (!entitlement.active) {
    return Response.json({ error: "You need an active plan to find leads. Choose a plan to continue.", code: "no_plan" }, { status: 402 });
  }
  if (entitlement.remaining !== null && entitlement.remaining <= 0) {
    return Response.json({ error: "You're out of credits. Top up or upgrade your plan to find more leads.", code: "quota_exceeded" }, { status: 402 });
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

  // Hard-cap the requested lead count to the remaining quota so a run can never
  // scrape past what the user is entitled to (e.g. 150 requested with 100 left →
  // capped to 100). Only applies when this run actually scrapes; unlimited plans
  // (remaining === null) are never capped. A blank or 0 max means "as many as
  // allowed", which is the remaining quota.
  let effectiveMax = body.max || "";
  let capped = false;
  if (stages.includes("scrape") && entitlement.remaining !== null) {
    const requested = parseInt(body.max, 10) || 0;
    if (requested === 0 || requested > entitlement.remaining) {
      effectiveMax = String(entitlement.remaining);
      capped = requested > entitlement.remaining;
    }
  }
  const result = await queue.enqueue(userId, {
    name: body.name,
    query: body.query || "",
    max: effectiveMax,
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
  return Response.json({ ok: true, queued: true, capped, max: effectiveMax, remaining: entitlement.remaining, ...result });
}
