export const dynamic = "force-dynamic";

// Escape hatch for a wedged sign-in.
//
// Symptom this exists for: the browser holds a session cookie that is no longer
// in the `sessions` table, every fresh sign-in writes a new row, and the new
// Set-Cookie never displaces the dead one. The browser keys cookies on
// (name, domain, path), so a cookie left behind on a *different* domain than
// the one the callback writes is invisible to Auth.js's overwrite and can win
// on the way out. Clearing it by hand in browser settings is fiddly.
//
// Keep this list tight. An earlier version emitted every name x suffix x domain
// combination - 264 Set-Cookie headers - which overran nginx's proxy buffer and
// returned 502, so the endpoint that was meant to unstick sign-in did nothing
// at all.

const NAMES = [
  "authjs.session-token",
  "authjs.csrf-token",
  "authjs.callback-url",
  "authjs.pkce.code_verifier",
];

export async function GET(request) {
  const url = new URL(request.url);
  const host = url.hostname; // e.g. app.leadsfunda.com
  const parts = host.split(".");
  const parent = parts.length > 2 ? parts.slice(-2).join(".") : host;

  const headers = new Headers();
  const kill = (name, domain, secure) => {
    let c = `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    if (secure) c += "; Secure";
    if (domain) c += `; Domain=${domain}`;
    headers.append("Set-Cookie", c);
  };

  for (const base of NAMES) {
    // Host-only is how Auth.js writes them; the domain forms cover cookies a
    // previous configuration may have scoped to the apex.
    for (const domain of [null, host, `.${parent}`]) {
      kill(base, domain, false);
      kill(`__Secure-${base}`, domain, true);
    }
    // __Host- cookies are invalid with a Domain attribute - sending one makes
    // the browser ignore the deletion entirely.
    kill(`__Host-${base}`, null, true);
  }

  headers.set("Location", "/login");
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 302, headers });
}
