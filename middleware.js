import { NextResponse } from "next/server";

// Lightweight edge gate for UX only: redirect users with no Auth.js session
// cookie away from the authenticated app to the landing page. Authoritative
// enforcement happens server-side (web/lib/session.js requireUser) since the
// database session can't be validated at the edge.
//
// Public: "/" (landing), "/api/auth/*" (sign-in), "/api/webhooks/*" (Whop),
// Next internals and static assets.
const PROTECTED_PREFIXES = ["/dashboard", "/leads", "/watchlist", "/agent"];

function hasSessionCookie(request) {
  const c = request.cookies;
  return Boolean(
    c.get("authjs.session-token") || c.get("__Secure-authjs.session-token")
  );
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (needsAuth && !hasSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("signin", "1");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
