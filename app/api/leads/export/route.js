import db from "../../../../web/lib/db.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, response } = await requireUser();
  if (response) return response;
  const csv = await db.exportCsv(userId);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="all-leads.csv"`,
    },
  });
}
