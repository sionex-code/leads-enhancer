// Shared Whop event dispatch logic — used by both:
//   - app/api/webhooks/whop/route.js       (direct Whop → LeadsFunda, HMAC-verified)
//   - app/api/webhooks/whop-relay/route.js (webmarkaz → LeadsFunda, secret-verified)
//
// Both endpoints receive the same raw Whop payload shape and run identical
// grant / revoke / queuePendingGrant logic; the only difference is the
// auth method before this module is called.

const { pool } = require("./pg.cjs");
const billing = require("./billing.cjs");

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

// Whop account id ("user_XXXX") — the STABLE identifier for a Whop account.
// Whop puts it at data.user.id on both membership.* and payment.* events.
// We prefer this over email for linking because it's permanent; the buyer can
// change their Whop email or their Google email and the link still holds.
function extractWhopUserId(data) {
  return (
    data?.user?.id ||
    data?.user_id ||
    data?.member?.id ||
    data?.customer?.id ||
    null
  );
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

// Dispatch one Whop event to the right billing action.
// Returns an object: { ok, handled?, plan?, skipped?, ignored? }
async function handleWhopEvent(event) {
  // Whop sends e.g. "membership.activated", "membership.deactivated",
  // "membership.cancel_at_period_end_changed", "payment.succeeded", "payment.failed".
  const action = (event?.action || event?.type || "").toLowerCase();
  const data = event?.data || event;

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
    return { ok: true, handled: "revoke" };
  }

  if (isGrant) {
    const whopPlanId = extractPlanId(data);
    const periodStart = toIso(data?.renewal_period_start || data?.current_period_start || data?.created_at);
    const periodEnd = toIso(data?.renewal_period_end || data?.current_period_end || data?.expires_at);
    const whopMembershipId = extractMembershipId(data);
    const whopUserId = extractWhopUserId(data);
    const email = extractEmail(data);

    // Link priority (most -> least specific):
    //   1. metadata.user_id — stamped at checkout by the in-app LeadsFunda
    //      /api/billing/checkout flow. Only set when the buyer is signed in.
    //   2. whop_user_id — stable Whop account id, stamped on the users row
    //      on the FIRST successful grant. After that, every renewal hits
    //      this index (immune to email changes).
    //   3. buyer email — fuzzy match against users.email. Final fallback.
    let userId = null;
    let matchedBy = null;

    const metaUserId = data?.metadata?.user_id || data?.checkout?.metadata?.user_id || null;
    if (metaUserId) {
      const { rows } = await pool().query(`SELECT id FROM users WHERE id = $1`, [metaUserId]);
      if (rows[0]) { userId = rows[0].id; matchedBy = "metadata.user_id"; }
    }

    if (!userId && whopUserId) {
      const id = await billing.findUserByWhopUserId(whopUserId);
      if (id) { userId = id; matchedBy = "whop_user_id"; }
    }

    if (!userId && email) {
      const { rows } = await pool().query(
        `SELECT id FROM users WHERE lower(email) = $1`,
        [email],
      );
      if (rows[0]) { userId = rows[0].id; matchedBy = "email"; }
    }

    if (!userId) {
      // No link found (paid before signing in, or new buyer). Stash the
      // grant with the whop_user_id so the user's leadsfunda row can be
      // backfilled with the stable Whop id on next sign-in.
      if (email) {
        await billing.queuePendingGrant({
          email,
          whopMembershipId,
          whopPlanId,
          whopUserId,
          periodStart,
          periodEnd,
        });
        return { ok: true, handled: "pending; will grant on sign-in" };
      }
      return { ok: true, skipped: "no user_id metadata, no whop_user_id, no email" };
    }

    await billing.grantMembership({
      userId,
      whopMembershipId,
      whopPlanId,
      whopUserId,
      periodStart,
      periodEnd,
    });
    return { ok: true, handled: "grant", plan: billing.planFromWhopId(whopPlanId), matchedBy };
  }

  return { ok: true, ignored: action };
}

module.exports = {
  handleWhopEvent,
  extractEmail,
  extractWhopUserId,
  extractPlanId,
  extractMembershipId,
  toIso,
};
