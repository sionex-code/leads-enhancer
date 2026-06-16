import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Starts a Whop checkout for the signed-in user, stamping our leadsfunda user_id
// into the checkout metadata. The Whop webhook then links the membership by
// metadata.user_id (deterministic) instead of guessing from the buyer's email.
//
//   GET /api/billing/checkout?plan=p19|p35|p49  ->  302 to the Whop checkout URL
//
// Primary path: create a checkout session via the Whop API (carries metadata
// reliably). Fallback: redirect to the static hosted-checkout URL with the
// user_id appended as a metadata query param.

const PLAN_ENV = { p19: "WHOP_PLAN_19", p35: "WHOP_PLAN_35", p49: "WHOP_PLAN_49" };
const CHECKOUT_ENV = { p19: "WHOP_CHECKOUT_19", p35: "WHOP_CHECKOUT_35", p49: "WHOP_CHECKOUT_49" };

function appUrl(path) {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}

// Static hosted-checkout URL (last-resort fallback). These do NOT carry metadata,
// so a membership bought this way can only be linked by the buyer's email match /
// pending-grant path — not the deterministic user_id link.
function staticCheckout(plan) {
  return process.env[CHECKOUT_ENV[plan]] || null;
}

// Create a Whop checkout session carrying our user_id in metadata, so the webhook
// links the membership deterministically (data.metadata.user_id). Verified live:
//   POST /api/v2/checkout_sessions { plan_id, metadata, redirect_url } -> 201
//   { purchase_url: "https://whop.com/checkout/<plan>/?session=ch_xxx", ... }
// Whop requires redirect_url to be https, so we omit it on non-https origins
// (local dev) and rely on the product-level redirect instead.
// Returns the purchase_url, or null on failure (caller falls back to static).
async function apiCheckout(plan, userId) {
  const apiKey = process.env.WHOP_API_KEY;
  const planId = process.env[PLAN_ENV[plan]];
  if (!apiKey || !planId) return null;
  const redirect = appUrl("/dashboard?upgraded=1");
  const body = { plan_id: planId, metadata: { user_id: userId } };
  if (redirect.startsWith("https://")) body.redirect_url = redirect;
  try {
    const res = await fetch("https://api.whop.com/api/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[billing] whop checkout_session failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json().catch(() => ({}));
    return data?.purchase_url || data?.url || data?.checkout_url || null;
  } catch (e) {
    console.error("[billing] whop checkout_session error:", e.message);
    return null;
  }
}

export async function GET(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const plan = new URL(request.url).searchParams.get("plan");
  if (!plan || !PLAN_ENV[plan]) {
    return Response.json({ error: "Unknown plan" }, { status: 400 });
  }

  const target = (await apiCheckout(plan, userId)) || staticCheckout(plan);
  if (!target) {
    return Response.json({ error: "Checkout not configured for this plan" }, { status: 500 });
  }
  return Response.redirect(target, 302);
}
