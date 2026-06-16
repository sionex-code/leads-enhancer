import queue from "../../../web/lib/queue.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// List this user's jobs (queued / running / done / failed) for the dashboard.
export async function GET() {
  const { userId, response } = await requireUser();
  if (response) return response;
  return Response.json({ jobs: await queue.listJobs(userId) });
}
