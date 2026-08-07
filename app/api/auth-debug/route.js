import { cookies } from "next/headers";
import { auth } from "../../../auth";
import { pool } from "../../../web/lib/pg.cjs";

export const dynamic = "force-dynamic";

// Diagnostic for "the browser has a session cookie but /api/me says 401".
//
// Reports cookie NAMES and whether the presented token matches a sessions row.
// Never returns a token, an email, or any value — a token is a bearer
// credential, and echoing one back over a URL anybody can hit would be handing
// out sessions.
export async function GET() {
  const jar = await cookies();
  const all = jar.getAll();

  const authCookies = all
    .map((c) => c.name)
    .filter((n) => n.toLowerCase().includes("authjs") || n.toLowerCase().includes("session"));

  // Both the plain and __Secure- names, because middleware accepts either and a
  // stale copy of one can shadow the other.
  const secure = jar.get("__Secure-authjs.session-token")?.value || "";
  const plain = jar.get("authjs.session-token")?.value || "";

  async function lookup(token) {
    if (!token) return "absent";
    try {
      const r = await pool().query(
        `SELECT expires FROM sessions WHERE session_token = $1 LIMIT 1`,
        [token]
      );
      if (!r.rows[0]) return "present-but-NOT-in-database";
      const exp = new Date(r.rows[0].expires);
      return exp > new Date() ? "valid" : `expired-at-${exp.toISOString()}`;
    } catch (e) {
      return `lookup-failed: ${e.message.slice(0, 60)}`;
    }
  }

  let sessionResolves = false;
  let hasUserId = false;
  try {
    const s = await auth();
    sessionResolves = !!s;
    hasUserId = !!s?.user?.id;
  } catch {
    /* reported as false below */
  }

  return Response.json(
    {
      cookieNamesPresent: authCookies,
      totalCookies: all.length,
      secureSessionCookie: await lookup(secure),
      plainSessionCookie: await lookup(plain),
      bothPresent: !!(secure && plain),
      authResolvesSession: sessionResolves,
      sessionHasUserId: hasUserId,
      hint: !secure && !plain
        ? "No session cookie reached the server — the browser is not storing or not sending it."
        : secure && plain
          ? "Two session cookies are present; a stale one may be shadowing the live one. Clearing cookies for this domain will fix it."
          : "Session cookie present — see the status above for whether it matches a live row.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
