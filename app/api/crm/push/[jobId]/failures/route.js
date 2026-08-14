import store from "../../../../../../web/lib/crm/store.cjs";
import { requireUser } from "../../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Which leads didn't land, and why — one row each, so a data problem on three
// leads reads differently from a token problem on all of them.
export async function GET(request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { jobId } = await params;
  const { searchParams } = new URL(request.url);

  const rows = await store.listFailures(userId, jobId, Number(searchParams.get("limit") || 200));
  if (rows === null) return Response.json({ error: "Push not found." }, { status: 404 });

  return Response.json({
    rows: rows.map((r) => ({ leadId: r.lead_id, name: r.name, error: r.error, attempts: r.attempts })),
  });
}
