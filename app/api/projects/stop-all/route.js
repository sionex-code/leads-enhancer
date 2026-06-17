import store from "../../../../web/lib/store.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Stop every running project for THIS user (and any orphaned Lighthouse/Chrome/
// scrape processes under their tenant dir), not just the selected one.
export async function POST() {
  const { userId, response } = await requireUser();
  if (response) return response;
  const result = store.stopAll(userId);
  return Response.json({ ok: true, ...result });
}
