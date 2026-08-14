import db from "../../../../../web/lib/db.cjs";
import store from "../../../../../web/lib/crm/store.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Where this one lead already lives in the user's CRMs, for the detail panel.
export async function GET(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });

  const rows = await store.getSyncForLead(userId, id);
  return Response.json({
    sync: rows.map((r) => ({
      connectionId: r.connection_id,
      label: r.label,
      provider: r.provider,
      status: r.status,
      action: r.action,
      remoteUrl: r.remote_url,
      error: r.error,
      lastPushedAt: r.last_pushed_at,
    })),
  });
}
