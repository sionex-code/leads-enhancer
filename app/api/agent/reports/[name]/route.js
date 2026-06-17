import fs from "fs";
import siteReport from "../../../../../web/lib/site-report.cjs";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { name } = await context.params;
  try {
    const file = siteReport.safeReportPath(name);
    if (!fs.existsSync(file)) return Response.json({ error: "Report not found" }, { status: 404 });
    return new Response(fs.readFileSync(file, "utf8"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return Response.json({ error: "Invalid report name" }, { status: 400 });
  }
}
