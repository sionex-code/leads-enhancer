import db from "../../../../../web/lib/db.cjs";
import billing from "../../../../../web/lib/billing.cjs";
import { detectChatbot } from "../../../../../web/lib/chatbot-detect.cjs";
import { withBrowser } from "../../../../../web/lib/browser-pool.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// On-demand chatbot/live-chat scan for one lead. Runs the full detector
// (network + DOM + shadow DOM; Ollama embedding layer auto-skipped if not
// running) and records the verdict + vendors + HTTP status onto the lead.
// Uses the shared browser pool so a flood of scans can't spawn a Chrome per call.
export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.website) return Response.json({ error: "This lead has no website to scan" }, { status: 400 });

  // Costs CHATBOT_COST credits per website. Charge up front; refund if the scan errors.
  const charge = await billing.consumeCredits(userId, billing.CHATBOT_COST, { reason: "chatbot", count: 1, project: lead.project });
  if (!charge.ok) {
    return Response.json(
      { error: `Not enough credits — a chatbot scan costs ${billing.CHATBOT_COST} credits and you have ${charge.credits}.`, code: "insufficient_credits", credits: charge.credits },
      { status: 402 }
    );
  }

  try {
    const r = await withBrowser((browser) => detectChatbot(lead.website, { browser }));
    const updated = await db.updateLeadScan(userId, id, {
      chatbot: r.hasChatbot ? "yes" : "no",
      chatbot_vendors: (r.vendors || []).join(", "),
      chatbot_method: r.method || "",
      chatbot_checked_at: new Date().toISOString(),
      http_status: r.httpStatus || null,
      http_status_text: r.httpStatusText || null,
      http_checked_at: new Date().toISOString(),
    });
    return Response.json({ lead: updated, detection: r, credits: charge.credits });
  } catch (err) {
    // Refund the charge since the scan didn't complete.
    await billing.addCredits(userId, billing.CHATBOT_COST, { reason: "refund", project: lead.project }).catch(() => {});
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
