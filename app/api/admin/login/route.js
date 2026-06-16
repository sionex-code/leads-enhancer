import { cookies } from "next/headers";
import {
  checkAdminCredentials,
  signAdminToken,
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
} from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { username, password } -> set the signed admin cookie on success.
export async function POST(request) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!checkAdminCredentials(username, password)) {
    return Response.json({ error: "Invalid admin credentials" }, { status: 401 });
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE, signAdminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return Response.json({ ok: true });
}

// DELETE -> admin sign out.
export async function DELETE() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}
