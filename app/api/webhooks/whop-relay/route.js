import crypto from "crypto";
import { handleWhopEvent } from "../../../../web/lib/whop-events.cjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Whop relay receiver — accepts the original Whop payload that was forwarded
// by webmarkaz.net (the marketing/frontend app) AFTER webmarkaz has already
// verified the Whop HMAC signature. We authenticate the relay hop with a
// shared secret in the X-Webmarkaz-Relay-Secret header instead of re-checking
// the Whop signature (because that signature was generated with webmarkaz's
// own webhook secret, not ours).
//
//   Buyer -> webmarkaz.net/pricing -> Whop checkout
//          -> POST https://webmarkaz.net/api/whop-webhook (Whop-signed)
//          -> POST https://leadsfunda.com/api/webhooks/whop-relay (this)
//          -> grant/revoke in memberships table

export async function POST(request) {
  // 1) Authenticate the relay hop (constant-time string compare).
  const expected = process.env.WEBMARKAZ_RELAY_SECRET;
  const provided = request.headers.get("x-webmarkaz-relay-secret") || "";
  if (!expected) {
    return Response.json(
      { error: "Relay not configured (WEBMARKAZ_RELAY_SECRET unset)" },
      { status: 500 },
    );
  }
  if (!provided || provided.length !== expected.length) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = crypto.timingSafeEqual(
    Buffer.from(provided, "utf8"),
    Buffer.from(expected, "utf8"),
  );
  if (!ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) Parse the forwarded Whop payload. It is the SAME raw body webmarkaz
  //    received from Whop, with the same shape — no transformation.
  const raw = await request.text();
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3) Dispatch — shared with the direct Whop endpoint.
  const action = event?.action || event?.type || "unknown";
  try {
    const result = await handleWhopEvent(event);
    return Response.json({ ...result, source: "relay" }, { status: 200 });
  } catch (err) {
    console.error("[whop-relay] handleWhopEvent error:", err?.message || err);
    return Response.json(
      { error: "Internal", action },
      { status: 500 },
    );
  }
}
