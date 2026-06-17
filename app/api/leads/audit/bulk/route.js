import db from "../../../../../web/lib/db.cjs";
import siteReport from "../../../../../web/lib/site-report.cjs";
import billing from "../../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Bulk quick-audit for selected leads. Cost = AUDIT_COST × (leads with a
// website). Credits are charged once, up front; the work is split into background
// jobs of MAX_AUDIT_SITES each, and each lead's desktop+mobile scores are written
// back onto it as the jobs run. If a chunk fails to start, its share is refunded.
// Returns { jobIds, count, charged, credits }.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((x) => Number(x)).filter(Boolean))] : [];
  if (!ids.length) return Response.json({ error: "No leads selected" }, { status: 400 });

  // Only the caller's own leads that actually have a website are billable.
  const leads = [];
  for (const id of ids) {
    const lead = await db.getLead(userId, id);
    if (lead && lead.website) leads.push(lead);
  }
  if (!leads.length) {
    return Response.json({ error: "None of the selected leads have a website to audit" }, { status: 400 });
  }

  const count = leads.length;
  const cost = billing.AUDIT_COST * count;
  const charge = await billing.consumeCredits(userId, cost, { reason: "audit", count, project: leads[0]?.project });
  if (!charge.ok) {
    return Response.json(
      { error: `Not enough credits — ${count} audit(s) need ${cost} credits and you have ${charge.credits}.`, code: "insufficient_credits", cost, count, credits: charge.credits },
      { status: 402 }
    );
  }

  // Persist each completed lead's scores onto its row, matched by id.
  const onResult = (site, scores) => (site.id != null ? db.updateLeadAudit(userId, site.id, scores) : null);

  // Split into background jobs of MAX_AUDIT_SITES; refund any chunk that can't start.
  const MAX = siteReport.MAX_AUDIT_SITES || 20;
  const jobIds = [];
  let refund = 0;
  for (let i = 0; i < leads.length; i += MAX) {
    const chunk = leads.slice(i, i + MAX);
    try {
      jobIds.push(siteReport.startAuditJob(chunk, { onResult }));
    } catch {
      refund += billing.AUDIT_COST * chunk.length;
    }
  }
  let credits = charge.credits;
  if (refund) credits = await billing.addCredits(userId, refund, { reason: "refund", project: leads[0]?.project });

  return Response.json({ jobIds, count, charged: cost - refund, credits });
}
