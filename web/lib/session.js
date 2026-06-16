// Server-side auth helpers for API routes. ESM (routes are ESM); pairs with the
// CJS data layer which now takes an explicit userId for tenant isolation.
import { auth } from "../../auth";

// Resolve the signed-in user id, or null. Real enforcement lives here (the edge
// middleware only does a cheap cookie redirect for UX).
export async function currentUserId() {
  const session = await auth();
  return session?.user?.id || null;
}

// Use at the top of a protected route:
//   const { userId, response } = await requireUser();
//   if (response) return response;
export async function requireUser() {
  const userId = await currentUserId();
  if (!userId) {
    return {
      userId: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId, response: null };
}

// Admins are listed in the ADMIN_EMAILS env (comma-separated). Only used to show
// the convenience "Admin panel" link in the account menu (via /api/me). The
// authoritative /admin gate is a separate username/password cookie — see
// web/lib/admin-auth.js.
export function isAdminEmail(email) {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(String(email).toLowerCase());
}
