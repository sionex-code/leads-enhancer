import db from "../../../../web/lib/db.cjs";

export async function GET() {
  const csv = db.exportCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="all-leads.csv"`,
    },
  });
}
