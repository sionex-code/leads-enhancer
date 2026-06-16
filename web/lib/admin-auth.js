// Standalone admin authentication (username + password), independent of the
// Google/user sessions. The /admin panel and /api/admin/* routes are gated by a
// signed, httpOnly cookie set after a correct ADMIN_USERNAME / ADMIN_PASSWORD.
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "lf_admin";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ADMIN_COOKIE_MAX_AGE = Math.floor(MAX_AGE_MS / 1000);

function secret() {
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "lf-admin-dev-secret";
}

function hmac(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

// Constant-time string compare that doesn't leak length via early return.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(bb, bb);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// True only when both env creds are set AND match. Unset env => admin login is
// closed (never accidentally open).
export function checkAdminCredentials(username, password) {
  const U = process.env.ADMIN_USERNAME;
  const P = process.env.ADMIN_PASSWORD;
  if (!U || !P) return false;
  const okU = safeEqual(username || "", U);
  const okP = safeEqual(password || "", P);
  return okU && okP;
}

export function signAdminToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_MS })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function verifyAdminToken(token) {
  if (!token || typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, hmac(payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

// Read + verify the admin cookie in a server context (route handler / RSC).
export async function isAdminAuthed() {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE)?.value);
}

// Guard for admin-only API routes:
//   const { response } = await requireAdmin();
//   if (response) return response;
export async function requireAdmin() {
  if (await isAdminAuthed()) return { response: null };
  return { response: Response.json({ error: "Admin authentication required" }, { status: 401 }) };
}
