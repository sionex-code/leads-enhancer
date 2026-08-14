import store from "../../../../../../web/lib/crm/store.cjs";
import crm from "../../../../../../web/lib/crm/index.cjs";
import { requireUser } from "../../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// The live list behind a "remote-select" config field — Smartlead and Instantly
// campaigns. Fetched with the user's own credentials so the dropdown shows
// their real campaigns instead of asking them to paste a UUID.
//
// 200 either way, like /test: a rejected key is an answer, not a fault.
export async function GET(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  const opened = await store.getConnectionWithCredentials(userId, id);
  if (!opened.ok) {
    if (opened.reason === "missing") return Response.json({ error: opened.error }, { status: 404 });
    return Response.json({ ok: false, error: opened.error, targets: [] });
  }

  const adapter = crm.get(opened.connection.provider);
  if (!adapter?.listTargets) return Response.json({ ok: true, targets: [] });

  const result = await adapter.listTargets(opened.credentials, opened.connection.config || {});
  return Response.json({
    ok: !!result.ok,
    error: result.ok ? null : result.error,
    targets: result.targets || [],
  });
}
