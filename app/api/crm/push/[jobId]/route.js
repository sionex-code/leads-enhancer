import store from "../../../../../web/lib/crm/store.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Polled every 2.5s while a push runs. Scoped to the signed-in user - unlike
// /api/agent/jobs/[id], which this deliberately does not copy.
export async function GET(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { jobId } = await params;

  const job = await store.getJob(userId, jobId);
  if (!job) return Response.json({ error: "Push not found." }, { status: 404 });

  return Response.json({
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    succeeded: job.succeeded,
    failed: job.failed,
    skipped: job.skipped,
    lastError: job.last_error,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
    connection: { id: job.connection_id, label: job.connection_label, provider: job.connection_provider },
  });
}

export async function DELETE(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { jobId } = await params;

  const ok = await store.requestCancel(userId, jobId);
  if (!ok) return Response.json({ error: "That push has already finished." }, { status: 409 });
  // The runner notices between chunks; in-flight requests are allowed to land
  // rather than being abandoned half-written in someone's CRM.
  return Response.json({ ok: true });
}
