import { auth } from "../../../../auth";
import pub from "../../../../web/lib/public-searches.cjs";

export const dynamic = "force-dynamic";

// GET /api/public/me -> { signedIn, label }
//
// The marketing host cannot see who is signed in. The session cookie is
// host-only to app.leadsfunda.com, so `auth()` on leadsfunda.com always reports
// nobody, which is why the landing page had no idea it was showing live results
// to a logged-in customer.
//
// A cross-origin fetch fixes it without moving the cookie: the browser will
// send a host-only cookie to its own host even when the page making the request
// is on another origin, provided the request sets credentials and this endpoint
// allows them. So the landing page calls THIS route on the app host.
//
// It returns the anonymised label only, never the name or the email. Same rule
// as the directory attribution: enough to say "we know it's you", not enough to
// be identity data sitting in a response any script on the page could read.
const ALLOWED_ORIGINS = new Set(
  [
    process.env.NEXT_PUBLIC_MARKETING_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_MARKETING_URL
      ? process.env.NEXT_PUBLIC_MARKETING_URL.replace("://", "://www.")
      : null,
  ].filter(Boolean)
);

// An allowlist, never a reflected `*`. Credentialed CORS with a wildcard is
// rejected by browsers anyway, and reflecting whatever Origin arrives would let
// any site read a signed-in visitor's label.
function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(request), "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

export async function GET(request) {
  const headers = { ...corsHeaders(request), "Cache-Control": "private, no-store" };
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ signedIn: false, label: "" }, { headers });
    const label = (await pub.labelForUser(userId)) || "";
    return Response.json({ signedIn: true, label }, { headers });
  } catch {
    return Response.json({ signedIn: false, label: "" }, { headers });
  }
}
