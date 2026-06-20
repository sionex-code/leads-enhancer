import db from "../../../web/lib/db.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Mark the first-run guided tour as seen (called when the user finishes or skips).
// POST { onboarded?: boolean } — defaults to true.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const onboarded = body.onboarded === false ? false : true;
  await db.setOnboarded(userId, onboarded);
  return Response.json({ ok: true, onboarded });
}
