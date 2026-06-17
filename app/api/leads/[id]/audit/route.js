import db from "../../../../../web/lib/db.cjs";
import siteReport from "../../../../../web/lib/site-report.cjs";
import billing from "../../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Kick off a quick audit (real-Chrome desktop + mobile Lighthouse scores only —
// no AI, no HTML report) for this lead's website. Costs AUDIT_COST credits,
// charged up front (refunded if the job fails to start). The scores are written
// back onto the lead (Health column) as the job completes. Returns a jobId the
// client polls at /api/agent/jobs/<id>, plus the remaining balance.
export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.website) return Response.json({ error: "This lead has no website to audit" }, { status: 400 });

  const cost = billing.AUDIT_COST;
  const charge = await billing.consumeCredits(userId, cost, { reason: "audit", count: 1, project: lead.project });
  if (!charge.ok) {
    return Response.json(
      { error: `Not enough credits — this audit needs ${cost} credits and you have ${charge.credits}.`, code: "insufficient_credits", cost, credits: charge.credits },
      { status: 402 }
    );
  }

  try {
    const jobId = siteReport.startAuditJob([lead], {
      onResult: (site, scores) => db.updateLeadAudit(userId, lead.id, scores),
    });
    return Response.json({ jobId, charged: cost, credits: charge.credits });
  } catch (err) {
    const credits = await billing.addCredits(userId, cost, { reason: "refund", count: 1, project: lead.project }); // refund — job never started
    return Response.json({ error: String(err.message || err), credits }, { status: 500 });
  }
}
