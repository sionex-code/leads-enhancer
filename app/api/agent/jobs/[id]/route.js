import siteReport from "../../../../../web/lib/site-report.cjs";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { id } = await context.params;
  const job = siteReport.getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json(job);
}
