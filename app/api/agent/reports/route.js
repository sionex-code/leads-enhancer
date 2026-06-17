import siteReport from "../../../../web/lib/site-report.cjs";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ reports: siteReport.listReports() });
}
