import db from "../../../../web/lib/db.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { checkStatus } from "../../../../web/lib/http-status.cjs";
import { detectChatbot } from "../../../../web/lib/chatbot-detect.cjs";
import { withBrowser } from "../../../../web/lib/browser-pool.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Batch website-status / chatbot scan. Body: { ids: number[], action: "status" | "chatbot" }.
// status  → fast concurrent HTTP checks.
// chatbot → full detector, one shared (pooled) Chrome reused across all leads.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "chatbot" ? "chatbot" : "status";
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return Response.json({ error: "No leads selected" }, { status: 400 });

  const fetched = await Promise.all(ids.map((id) => db.getLead(userId, id)));
  const leads = fetched.filter((l) => l && l.website);
  const now = () => new Date().toISOString();
  const results = [];

  if (action === "status") {
    const CONCURRENCY = 8;
    let i = 0;
    async function worker() {
      while (i < leads.length) {
        const lead = leads[i++];
        const r = await checkStatus(lead.website);
        const updated = await db.updateLeadScan(userId, lead.id, {
          http_status: r.status || null,
          http_status_text: r.statusText || null,
          http_checked_at: now(),
        });
        results.push(updated);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, leads.length) }, worker));
    return Response.json({ ok: true, count: results.length, leads: results });
  }

  // chatbot: costs CHATBOT_COST credits per website. Charge up front, refund any
  // site that fails to scan (mirrors the bulk-audit billing).
  const count = leads.length;
  const cost = billing.CHATBOT_COST * count;
  const charge = await billing.consumeCredits(userId, cost, { reason: "chatbot", count, project: leads[0]?.project });
  if (!charge.ok) {
    return Response.json(
      { error: `Not enough credits — scanning ${count} site(s) needs ${cost} credits and you have ${charge.credits}.`, code: "insufficient_credits", cost, count, credits: charge.credits },
      { status: 402 }
    );
  }

  let failed = 0;
  // chatbot: reuse the pooled browser to avoid launching dozens of Chrome procs.
  await withBrowser(async (browser) => {
    for (const lead of leads) {
      try {
        const r = await detectChatbot(lead.website, { browser });
        const updated = await db.updateLeadScan(userId, lead.id, {
          chatbot: r.hasChatbot ? "yes" : "no",
          chatbot_vendors: (r.vendors || []).join(", "),
          chatbot_method: r.method || "",
          chatbot_checked_at: now(),
          http_status: r.httpStatus || null,
          http_status_text: r.httpStatusText || null,
          http_checked_at: now(),
        });
        results.push(updated);
      } catch (err) {
        failed++;
        results.push({ id: lead.id, error: String(err.message || err) });
      }
    }
  });
  let credits = charge.credits;
  if (failed) credits = await billing.addCredits(userId, failed * billing.CHATBOT_COST, { reason: "refund", project: leads[0]?.project });
  return Response.json({ ok: true, count: results.length, leads: results, charged: cost - failed * billing.CHATBOT_COST, credits });
}
