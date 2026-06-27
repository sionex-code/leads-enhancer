import crypto from "crypto";
import { handleWhopEvent } from "../../../../web/lib/whop-events.cjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Whop billing webhook. Grants/renews a membership on valid/payment events and
// revokes on invalid/cancel — linked to a user by EMAIL match (Google identity).
// Public (no session) but HMAC-verified with WHOP_WEBHOOK_SECRET.
//
// The dispatch + extraction logic lives in web/lib/whop-events.cjs so this
// endpoint and the /api/webhooks/whop-relay endpoint share the same code.

function verifySignature(rawBody, header, secret) {
  if (!secret) return true; // no secret configured (dev) → skip verification
  if (!header) return false;
  // Whop signs the raw body with HMAC-SHA256. Accept "sha256=<hex>" or bare hex.
  const provided = header.includes("=") ? header.split("=").pop().trim() : header.trim();
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request) {
  const raw = await request.text();
  const sig =
    request.headers.get("x-whop-signature") ||
    request.headers.get("whop-signature") ||
    request.headers.get("x-signature") ||
    "";
  if (!verifySignature(raw, sig, process.env.WHOP_WEBHOOK_SECRET)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await handleWhopEvent(event);
  return Response.json(result, { status: 200 });
}
