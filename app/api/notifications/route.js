import notifications from "../../../web/lib/notifications.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const unreadOnly = new URL(request.url).searchParams.get("unread") === "1";
  const [items, unread] = await Promise.all([
    notifications.list(userId, { unreadOnly }),
    notifications.unreadCount(userId),
  ]);
  return Response.json({ notifications: items, unread });
}

// Mark notifications read. Body: { ids?: number[] } — omit ids to mark all.
export async function PATCH(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  await notifications.markRead(userId, body.ids);
  return Response.json({ ok: true });
}
