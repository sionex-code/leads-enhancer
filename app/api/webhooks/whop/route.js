import crypto from "crypto";
import billing from "../../../../web/lib/billing.cjs";
import pg from "../../../../web/lib/pg.cjs";

const { pool } = pg;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Whop billing webhook. Grants/renews a membership on valid/payment events and
// revokes on invalid/cancel — linked to a user by EMAIL match (Google identity).
// Public (no session) but HMAC-verified with WHOP_WEBHOOK_SECRET.

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

// Best-effort extraction of the buyer email from a Whop event payload.
// Whop puts it at data.user.email on both membership.* and payment.* events.
function extractEmail(data) {
  return (
    data?.user?.email ||
    data?.email ||
    data?.member?.email ||
    data?.customer?.email ||
    ""
  ).toLowerCase();
}

// Whop plan id lives at data.plan.id (membership + payment events); fall back to
// older/flat shapes just in case.
function extractPlanId(data) {
  return (
    (typeof data?.plan === "object" ? data?.plan?.id : data?.plan) ||
    data?.plan_id ||
    data?.product_id ||
    null
  );
}

// Whop membership id: data.id on membership.* events, data.membership(.id) on payment.*.
function extractMembershipId(data) {
  return (
    data?.membership_id ||
    (typeof data?.membership === "object" ? data?.membership?.id : data?.membership) ||
    data?.id ||
    null
  );
}

function toIso(v) {
  if (!v) return null;
  // Whop sends unix seconds for period fields.
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
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

  // Whop sends e.g. "membership.activated", "membership.deactivated",
  // "membership.cancel_at_period_end_changed", "payment.succeeded", "payment.failed".
  const action = (event.action || event.type || "").toLowerCase();
  const data = event.data || event;

  // Real revoke: membership deactivated/expired/deleted. NOT
  // cancel_at_period_end_changed (access continues until period end) and NOT
  // payment.failed (a single failed charge isn't a cancellation).
  const isRevoke =
    /membership\.(deactivat|expired|deleted|invalid)/.test(action) ||
    (/invalid|expired|deleted/.test(action) && !/payment/.test(action));

  // Grant/renew: membership activated, or a successful payment.
  const isGrant =
    /membership\.(activat|valid|created|went_valid)/.test(action) ||
    /payment\.(succeeded|completed|success)/.test(action) ||
    (/valid|succeeded|completed/.test(action) && !/invalid|failed/.test(action));

  if (isRevoke) {
    const whopMembershipId = extractMembershipId(data);
    if (whopMembershipId) await billing.revokeMembershipByWhopId(whopMembershipId);
    return Response.json({ ok: true, handled: "revoke" });
  }

  if (isGrant) {
    const whopPlanId = extractPlanId(data);
    const periodStart = toIso(data?.renewal_period_start || data?.current_period_start || data?.created_at);
    const periodEnd = toIso(data?.renewal_period_end || data?.current_period_end || data?.expires_at);
    const whopMembershipId = extractMembershipId(data);

    // PRIMARY link: the leadsfunda user_id we stamped onto the checkout metadata.
    // This is deterministic and immune to the buyer's Whop email differing from
    // their Google sign-in email.
    const metaUserId = data?.metadata?.user_id || data?.checkout?.metadata?.user_id || null;
    let userId = null;
    if (metaUserId) {
      const { rows } = await pool().query(`SELECT id FROM users WHERE id = $1`, [metaUserId]);
      if (rows[0]) userId = rows[0].id;
    }

    // FALLBACK link: match the buyer email to a signed-in user.
    const email = extractEmail(data);
    if (!userId && email) {
      const { rows } = await pool().query(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
      if (rows[0]) userId = rows[0].id;
    }

    if (!userId) {
      // No metadata, and no user with this email yet (paid before signing in).
      // Stash the grant; it's applied on that email's next sign-in.
      if (email) {
        await billing.queuePendingGrant({ email, whopMembershipId, whopPlanId, periodStart, periodEnd });
        return Response.json({ ok: true, handled: "pending; will grant on sign-in" });
      }
      return Response.json({ ok: true, skipped: "no user_id metadata, no email" });
    }

    await billing.grantMembership({ userId, whopMembershipId, whopPlanId, periodStart, periodEnd });
    return Response.json({ ok: true, handled: "grant", plan: billing.planFromWhopId(whopPlanId) });
  }

  return Response.json({ ok: true, ignored: action });
}
