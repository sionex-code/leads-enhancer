import store from "../../../../web/lib/store.cjs";
import queue from "../../../../web/lib/queue.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Stop every running project for THIS user (and any orphaned Lighthouse/Chrome/
// scrape processes under their tenant dir), not just the selected one.
export async function POST() {
  const { userId, response } = await requireUser();
  if (response) return response;
  const result = store.stopAll(userId);
  // Also cancel every queued/running jobs row for this user so nothing waiting in
  // the queue gets promoted after a Stop all, and all their slots free at once.
  let canceledJobs = 0;
  try { canceledJobs = await queue.cancelAllForUser(userId); } catch {}
  return Response.json({ ok: true, canceledJobs, ...result });
}
