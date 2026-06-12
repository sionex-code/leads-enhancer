import siteReport from "../../../../../web/lib/site-report.cjs";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { id } = await context.params;
  const job = siteReport.getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json(job);
}

// DELETE → cancel a running report job
export async function DELETE(_request, context) {
  const { id } = await context.params;
  const job = siteReport.cancelJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json(job);
}
