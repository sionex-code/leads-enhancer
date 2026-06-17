import db from "../../../../../web/lib/db.cjs";
import siteReport from "../../../../../web/lib/site-report.cjs";
import billing from "../../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Bulk website reports for selected leads. Cost = REPORT_COST × (leads with a
// website). Credits are charged once, up front; the work is split into background
// jobs of MAX_SITES each. If a chunk fails to start, its share is refunded.
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
    return Response.json({ error: "None of the selected leads have a website to report on" }, { status: 400 });
  }

  // Reuse existing reports: if a report already exists on disk for a lead's domain,
  // skip it — no charge, no regenerate. The user can open the existing one. Reports
  // are named "<sanitized-domain>-<ts>.html" (see startReportJob); the same domain
  // set powers the "Report ✓" badge in the leads list.
  const sanitizeDomain = (d) => String(d || "").replace(/[^a-z0-9.-]/gi, "_");
  const reported = new Set();
  try {
    for (const r of siteReport.listReports()) {
      if (r.file.includes("-lighthouse")) continue;
      reported.add(r.file.replace(/-\d+\.html$/, ""));
    }
  } catch {}
  const todo = leads.filter((l) => !(l.domain && reported.has(sanitizeDomain(l.domain))));
  const skipped = leads.length - todo.length;
  if (!todo.length) {
    const credits = await billing.getCredits(userId);
    return Response.json({ jobIds: [], count: 0, skipped, charged: 0, credits, cached: true });
  }

  const count = todo.length;
  const cost = billing.REPORT_COST * count;
  const charge = await billing.consumeCredits(userId, cost);
  if (!charge.ok) {
    return Response.json(
      { error: `Not enough credits — ${count} report(s) need ${cost} credits and you have ${charge.credits}.`, code: "insufficient_credits", cost, count, credits: charge.credits },
      { status: 402 }
    );
  }

  // Split into background jobs of MAX_SITES; refund any chunk that can't start.
  const MAX = siteReport.MAX_SITES || 5;
  const jobIds = [];
  let refund = 0;
  for (let i = 0; i < todo.length; i += MAX) {
    const chunk = todo.slice(i, i + MAX);
    try {
      jobIds.push(siteReport.startReportJob(chunk));
    } catch {
      refund += billing.REPORT_COST * chunk.length;
    }
  }
  let credits = charge.credits;
  if (refund) credits = await billing.addCredits(userId, refund);

  return Response.json({ jobIds, count, skipped, charged: cost - refund, credits });
}
