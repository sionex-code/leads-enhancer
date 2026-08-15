import store from "../../../../../../web/lib/crm/store.cjs";
import crm from "../../../../../../web/lib/crm/index.cjs";
import { requireUser } from "../../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Answers 200 whether or not the credentials work. A rejected token is not an
// API error - it is the answer to the question the user asked - and the UI
// renders `error` as a sentence either way.
export async function POST(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  const opened = await store.getConnectionWithCredentials(userId, id);
  if (!opened.ok) {
    if (opened.reason === "missing") return Response.json({ error: opened.error }, { status: 404 });
    await store.updateConnection(userId, id, { status: "error", lastError: opened.error, lastTestedAt: new Date().toISOString() });
    return Response.json({ ok: false, error: opened.error });
  }

  const adapter = crm.get(opened.connection.provider);
  if (!adapter) return Response.json({ error: "Unknown integration type." }, { status: 400 });

  const result = await adapter.testConnection(opened.credentials, opened.connection.config || {});

  // A provider may learn things during the test that later calls need - the
  // HubSpot portal id, the Pipedrive account subdomain - so it can hand back a
  // config patch to merge.
  const patch = {
    status: result.ok ? "ok" : "error",
    lastError: result.ok ? null : result.error,
    lastTestedAt: new Date().toISOString(),
  };
  if (result.ok && result.config) patch.config = { ...(opened.connection.config || {}), ...result.config };
  const updated = await store.updateConnection(userId, id, patch);

  return Response.json({
    ok: !!result.ok,
    error: result.ok ? null : result.error,
    account: result.account || null,
    connection: updated.connection,
  });
}
