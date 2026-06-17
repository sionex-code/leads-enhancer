import queue from "../../../../web/lib/queue.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: every queued/running scrape job across all users, so an admin can
// see what's running right now. Also nudges the supervisor on each poll.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  queue.kick();
  const operations = await queue.listActiveJobs();
  return Response.json({ operations, maxConcurrent: queue.MAX_CONCURRENT });
}
