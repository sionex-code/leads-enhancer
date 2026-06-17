import queue from "../../../../web/lib/queue.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Cancel a queued or running job (kills the runner if running).
export async function DELETE(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const result = await queue.cancel(userId, id);
  return Response.json(result, { status: result.ok ? 200 : 404 });
}
