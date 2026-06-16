import { auth } from "../../../auth";
import billing from "../../../web/lib/billing.cjs";
import notifications from "../../../web/lib/notifications.cjs";
import { isAdminEmail } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Current user + plan entitlement + unread notification count, for the app shell.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [entitlement, unread] = await Promise.all([
    billing.getEntitlement(userId),
    notifications.unreadCount(userId),
  ]);
  return Response.json({
    user: { id: userId, email: session.user.email, name: session.user.name, image: session.user.image },
    entitlement,
    unread,
    admin: isAdminEmail(session.user.email),
  });
}
