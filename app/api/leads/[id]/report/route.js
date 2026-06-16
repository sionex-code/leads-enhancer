import db from "../../../../../web/lib/db.cjs";
import siteReport from "../../../../../web/lib/site-report.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Kick off an independent report (inspection + fast real-Chrome audit on desktop
// + mobile + AI analysis) for this lead's website. Returns a jobId the client
// polls at /api/agent/jobs/<id>.
export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.website) return Response.json({ error: "This lead has no website to analyze" }, { status: 400 });
  try {
    const jobId = siteReport.startReportJob([lead]);
    return Response.json({ jobId });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Latest generated report(s) for this lead's domain.
export async function GET(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  const domain = (lead.domain || "").replace(/[^a-z0-9.-]/gi, "_");
  const reports = domain ? siteReport.listReports().filter((r) => r.file.startsWith(`${domain}-`) && !r.file.includes("-lighthouse")) : [];
  return Response.json({ reports });
}
