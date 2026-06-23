import { NextResponse } from "next/server";

// Two-host topology (see deploy-saas.yml + the VPS nginx vhosts):
//   • Marketing landing  -> leadsfunda.com (+ www)   [NEXT_PUBLIC_MARKETING_URL]
//   • Authenticated app  -> app.leadsfunda.com        [NEXT_PUBLIC_APP_URL]
// Both hostnames proxy to the SAME Next.js process; this middleware enforces the
// split. Auth (Google OAuth + the session cookie) lives only on the app host
// (NEXTAUTH_URL = the app host), so the marketing landing just links over to it.
//
// When the two URLs are unset (local dev / single host) we fall back to the
// original single-host UX gate. Authoritative enforcement is still server-side
// (web/lib/session.js requireUser); this is only for routing/UX.

function hostOf(u) {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return "";
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "";
const APP_HOST = hostOf(APP_URL);
const MARKETING_HOST = hostOf(MARKETING_URL);

// Pages that belong on the app host (the marketing host bounces these over).
const APP_ONLY = [
  "/dashboard",
  "/leads",
  "/watchlist",
  "/agent",
  "/billing",
  "/lists",
  "/admin",
  "/login",
];
// Subset that requires a Google session (/admin self-authenticates with its own
// cookie, so it is intentionally excluded here).
const GOOGLE_GATED = ["/dashboard", "/leads", "/watchlist", "/agent", "/billing", "/lists"];

function matchPrefix(pathname, prefixes) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function hasSessionCookie(request) {
  const c = request.cookies;
  return Boolean(
    c.get("authjs.session-token") || c.get("__Secure-authjs.session-token")
  );
}

export function middleware(request) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get("host") || "").toLowerCase();

  // ---- Two-host mode (production) ----------------------------------------
  if (APP_HOST && MARKETING_HOST) {
    const onApp = host === APP_HOST;
    const onMarketing = host === MARKETING_HOST || host === "www." + MARKETING_HOST;

    // The marketing host never serves the app: send app pages to the app host.
    if (onMarketing && matchPrefix(pathname, APP_ONLY)) {
      return NextResponse.redirect(new URL(pathname + search, APP_URL));
    }

    if (onApp) {
      // No marketing landing on the app host: route "/" to the dashboard or sign-in.
      if (pathname === "/") {
        const url = request.nextUrl.clone();
        url.pathname = hasSessionCookie(request) ? "/dashboard" : "/login";
        url.search = "";
        return NextResponse.redirect(url);
      }
      // Gate the authenticated pages: bounce signed-out users to /login.
      if (matchPrefix(pathname, GOOGLE_GATED) && !hasSessionCookie(request)) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "";
        url.searchParams.set("callbackUrl", pathname + search);
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  // ---- Single-host fallback (local dev) ----------------------------------
  if (matchPrefix(pathname, GOOGLE_GATED) && !hasSessionCookie(request)) {
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
