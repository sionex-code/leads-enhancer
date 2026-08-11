import { auth } from "../../../auth";
import billing from "../../../web/lib/billing.cjs";
import db from "../../../web/lib/db.cjs";
import notifications from "../../../web/lib/notifications.cjs";
import { isAdminEmail } from "../../../web/lib/session.js";
import { DEV_AUTH_ENABLED, devMePayload } from "../../../web/lib/dev-auth.js";

export const dynamic = "force-dynamic";

// Current user + plan entitlement + unread notification count, for the app shell.
export async function GET() {
  // The app shell polls this on every page; answer it from the stub so the local
  // session works without Postgres (dev only — see web/lib/dev-auth.js).
  if (DEV_AUTH_ENABLED) return Response.json(devMePayload());
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [entitlement, daily, unread, onboarded] = await Promise.all([
    billing.getEntitlement(userId),
    billing.getDailyUsage(userId),
    notifications.unreadCount(userId),
    db.isOnboarded(userId),
  ]);
  return Response.json({
    user: { id: userId, email: session.user.email, name: session.user.name, image: session.user.image },
    entitlement,
    daily,
    unread,
    onboarded,
    admin: isAdminEmail(session.user.email),
  });
}
