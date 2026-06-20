import store from "../../../../../web/lib/store.cjs";
import queue from "../../../../../web/lib/queue.cjs";
import db from "../../../../../web/lib/db.cjs";
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
    const status = store.loadStatus(slug, userId);
    // The workspace renders from the raw warehouse CSV, so enrichment/WhatsApp the
    // user ran after the find would disappear on reload. Restore it from the shared
    // caches (best-effort: never let a cache hiccup 500 the status poll).
    try {
      await db.fillLeadsFromCaches(status.leads);
    } catch {}
    return Response.json(status);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}
