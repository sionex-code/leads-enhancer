import store from "../../../../../web/lib/store.cjs";
import queue from "../../../../../web/lib/queue.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { slug } = await context.params;
  const dir = store.safeProjectDir(slug, userId);
  const state = store.readState(dir);
  if (state.activePid) store.killTree(state.activePid);
  // Cancel any queued/running jobs row for this project too — otherwise a job that
  // was still QUEUED would later be promoted and silently re-launch the project the
  // user just stopped, and a running row would keep holding its concurrency slot.
  try { await queue.cancelByProject(userId, store.slugify(slug)); } catch {}
  store.writeState(dir, {
    running: false,
    queued: false,
    activePid: null,
    message: "Stopped",
    stoppedAt: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}
