import store from "../../../../../../web/lib/crm/store.cjs";
import runner from "../../../../../../web/lib/crm/runner.cjs";
import { requireUser } from "../../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Retry just the leads that failed, as a new job. A new job rather than a
// rewind of the old one, so the history keeps showing what actually happened
// the first time.
export async function POST(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { jobId } = await params;

  const original = await store.getJob(userId, jobId);
  if (!original) return Response.json({ error: "Push not found." }, { status: 404 });

  const leadIds = await store.failedLeadIds(userId, jobId);
  if (!leadIds.length) return Response.json({ error: "Nothing failed in that push." }, { status: 400 });

  const connection = await store.getConnection(userId, original.connection_id);
  if (!connection) return Response.json({ error: "That integration has been removed." }, { status: 404 });
  if (connection.status === "error") {
    return Response.json(
      { error: `"${connection.label}" needs reconnecting before it can receive leads.`, code: "connection_error" },
      { status: 409 }
    );
  }

  const job = await store.createJob(userId, {
    connectionId: connection.id,
    mode: "ids",
    // A retry must send even when nothing changed - the point is that last time
    // it didn't arrive.
    source: { retryOf: original.id, skipUnchanged: false },
    leadIds,
  });
  runner.kick(job.id);

  return Response.json(
    { jobId: job.id, total: job.total, connection: { id: connection.id, label: connection.label, provider: connection.provider } },
    { status: 202 }
  );
}
