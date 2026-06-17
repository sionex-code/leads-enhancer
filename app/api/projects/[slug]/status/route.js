import store from "../../../../../web/lib/store.cjs";
import queue from "../../../../../web/lib/queue.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { slug } = await context.params;
  // Self-heal the queue on every status poll so a job can never stay stuck on
  // "waiting for a free slot" if the background supervisor interval isn't running.
  queue.kick();
  try {
    return Response.json(store.loadStatus(slug, userId));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}
