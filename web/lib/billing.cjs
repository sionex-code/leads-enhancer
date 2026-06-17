// Membership + quota + report-credits logic (Whop-backed). The Whop webhook
// (app/api/webhooks/whop) writes the `memberships` row; this module reads it to
// decide whether a user may run jobs, how many leads they have left this period,
// and how many report credits they hold.
//
// Plans (monthly price · lead quota · report credits granted per period):
//   p19  $19  ·  5,000 leads   ·  500 credits
//   p35  $35  ·  50,000 leads  ·  1,500 credits
//   p49  $49  ·  unlimited     ·  4,000 credits
// Free (no active plan): a global, admin-tunable monthly grant (default 100).
// Each website report costs REPORT_COST credits.
const { pool } = require("./pg.cjs");

const PLAN_QUOTAS = { p19: 5000, p35: 50000, p49: null }; // null = unlimited
const PLAN_PRICES = { p19: 19, p35: 35, p49: 49 };
const PLAN_CREDITS = { p19: 500, p35: 1500, p49: 4000 }; // monthly report credits
const PLAN_LABELS = { p19: "Starter", p35: "Growth", p49: "Scale" };
const REPORT_COST = 10; // credits per full website report (audit + AI + chatbot)
const AUDIT_COST = 3; // credits per quick audit (desktop + mobile Lighthouse scores only)

const now = () => new Date().toISOString();
const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : ""); // YYYY-MM

// Map a Whop plan id (from env) to our internal tier.
function planFromWhopId(whopPlanId) {
  if (!whopPlanId) return null;
  if (whopPlanId === process.env.WHOP_PLAN_19) return "p19";
  if (whopPlanId === process.env.WHOP_PLAN_35) return "p35";
  if (whopPlanId === process.env.WHOP_PLAN_49) return "p49";
  return null;
}

function quotaForPlan(plan) {
  return plan in PLAN_QUOTAS ? PLAN_QUOTAS[plan] : 0;
}

// ---- global app settings (admin key/value) ----------------------------------
async function getSetting(key, fallback = null) {
  const { rows } = await pool().query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return rows[0] ? rows[0].value : fallback;
}

async function setSetting(key, value) {
  await pool().query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value == null ? null : String(value), now()]
  );
}

// The free monthly credit grant for accounts without a paid plan.
async function getFreeMonthlyConfig() {
  const [enabled, amount] = await Promise.all([
    getSetting("free_monthly_credits_enabled", "1"),
    getSetting("free_monthly_credits", "100"),
  ]);
  return { enabled: enabled === "1" || enabled === "true", amount: Math.max(0, parseInt(amount, 10) || 0) };
}

async function setFreeMonthlyConfig({ enabled, amount } = {}) {
  if (enabled !== undefined) await setSetting("free_monthly_credits_enabled", enabled ? "1" : "0");
  if (amount !== undefined) await setSetting("free_monthly_credits", String(Math.max(0, parseInt(amount, 10) || 0)));
  return getFreeMonthlyConfig();
}

// ---- credits ----------------------------------------------------------------
function isPaidActive(m) {
  return (
    m &&
    m.status === "active" &&
    m.plan in PLAN_CREDITS &&
    (!m.current_period_end || Date.parse(m.current_period_end) > Date.now())
  );
}

// What a user's monthly credit grant should be: a per-user override wins, then the
// active paid plan's allotment, then the global free grant (if enabled).
function effectiveMonthly(m, free) {
  if (m && m.credits_monthly != null) return Math.max(0, m.credits_monthly);
  if (isPaidActive(m)) return PLAN_CREDITS[m.plan] || 0;
  return free.enabled ? free.amount : 0;
}

// Ensure the user has a membership row (free users need one to hold credits) and
// apply the monthly credit grant if a new calendar month has begun since the last
// grant. Returns the fresh membership row. Cheap on the hot path: one SELECT when
// the row exists and this month's grant already happened.
async function ensureCredits(userId) {
  let { rows } = await pool().query(`SELECT * FROM memberships WHERE user_id = $1`, [userId]);
  let m = rows[0];
  if (!m) {
    await pool().query(
      `INSERT INTO memberships (user_id, status, leads_used, credits, updated_at)
         VALUES ($1, 'inactive', 0, 0, $2) ON CONFLICT (user_id) DO NOTHING`,
      [userId, now()]
    );
    ({ rows } = await pool().query(`SELECT * FROM memberships WHERE user_id = $1`, [userId]));
    m = rows[0];
    if (!m) return null;
  }
  const free = await getFreeMonthlyConfig();
  const due = !m.credits_renewed_at || monthKey(m.credits_renewed_at) < monthKey(now());
  if (due) {
    const grant = effectiveMonthly(m, free);
    const ts = now();
    const upd = await pool().query(
      `UPDATE memberships SET credits = credits + $1, credits_renewed_at = $2, updated_at = $2
         WHERE user_id = $3 RETURNING *`,
      [grant, ts, userId]
    );
    m = upd.rows[0] || m;
  }
  return m;
}

// Current report-credit balance (after applying any due monthly grant).
async function getCredits(userId) {
  const m = await ensureCredits(userId);
  return m ? m.credits || 0 : 0;
}

// Append a row to the credit-spend ledger. Best-effort: a ledger hiccup must
// never fail the actual credit operation. delta < 0 = spend, > 0 = grant/topup/refund.
async function recordCreditTxn(userId, { delta, reason, count = null, project = null, balanceAfter = null }) {
  try {
    await pool().query(
      `INSERT INTO credit_transactions (user_id, delta, reason, count, project, balance_after, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, Math.trunc(delta), String(reason || "spend"), count == null ? null : Math.trunc(count), project || null, balanceAfter == null ? null : Math.trunc(balanceAfter), now()]
    );
  } catch (err) {
    console.warn("[billing] credit ledger write failed:", err.message);
  }
}

// Atomically spend `n` credits. Returns { ok, credits }. ok=false (without
// charging) when the balance is insufficient — the conditional UPDATE makes this
// race-safe across concurrent report requests. `meta` ({ reason, count, project })
// is recorded to the credit-spend ledger on success.
async function consumeCredits(userId, n, meta = {}) {
  n = Math.max(0, Math.floor(n || 0));
  if (n === 0) return { ok: true, credits: await getCredits(userId) };
  await ensureCredits(userId); // make sure the row + monthly grant exist first
  const { rows } = await pool().query(
    `UPDATE memberships SET credits = credits - $1, updated_at = $2
       WHERE user_id = $3 AND credits >= $1 RETURNING credits`,
    [n, now(), userId]
  );
  if (!rows[0]) {
    const { rows: cur } = await pool().query(`SELECT credits FROM memberships WHERE user_id = $1`, [userId]);
    return { ok: false, credits: cur[0] ? cur[0].credits || 0 : 0 };
  }
  await recordCreditTxn(userId, { delta: -n, reason: meta.reason || "spend", count: meta.count, project: meta.project, balanceAfter: rows[0].credits });
  return { ok: true, credits: rows[0].credits };
}

// Add credits (admin top-up, or refunding a report that failed to start). `meta`
// ({ reason, count, project }) is recorded to the ledger.
async function addCredits(userId, n, meta = {}) {
  n = Math.floor(n || 0);
  if (!n) return getCredits(userId);
  await ensureCredits(userId);
  const { rows } = await pool().query(
    `UPDATE memberships SET credits = GREATEST(0, credits + $1), updated_at = $2 WHERE user_id = $3 RETURNING credits`,
    [n, now(), userId]
  );
  const credits = rows[0] ? rows[0].credits : 0;
  await recordCreditTxn(userId, { delta: n, reason: meta.reason || (n > 0 ? "topup" : "adjust"), count: meta.count, project: meta.project, balanceAfter: credits });
  return credits;
}

// Paginated credit-spend history for a user, newest first. Returns { rows, total }.
async function listCreditTransactions(userId, { limit = 20, offset = 0 } = {}) {
  limit = Math.min(100, Math.max(1, Number(limit) || 20));
  offset = Math.max(0, Number(offset) || 0);
  const totalRes = await pool().query(`SELECT COUNT(*)::int AS c FROM credit_transactions WHERE user_id = $1`, [userId]);
  const { rows } = await pool().query(
    `SELECT id, delta, reason, count, project, balance_after, created_at
       FROM credit_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return { rows, total: totalRes.rows[0].c };
}

// Set an absolute credit balance (admin).
async function setUserCredits(userId, credits) {
  const value = Math.max(0, Math.floor(credits || 0));
  await ensureCredits(userId);
  await pool().query(`UPDATE memberships SET credits = $1, updated_at = $2 WHERE user_id = $3`, [value, now(), userId]);
  return value;
}

// Set (or clear, with null) a per-user monthly credit override (admin).
async function setUserMonthlyCredits(userId, monthly) {
  const value = monthly == null || monthly === "" ? null : Math.max(0, Math.floor(monthly));
  await ensureCredits(userId);
  await pool().query(`UPDATE memberships SET credits_monthly = $1, updated_at = $2 WHERE user_id = $3`, [value, now(), userId]);
  return value;
}

// ---- entitlement ------------------------------------------------------------
// Current entitlement for a user: { active, plan, quota, used, remaining, credits,
// creditsMonthly }. remaining === null means unlimited. active=false when no/expired
// membership (credits still work for free accounts).
async function getEntitlement(userId) {
  const m = await ensureCredits(userId); // also lazily creates the row + grants monthly
  if (!m || m.status !== "active") {
    return { active: false, plan: null, quota: 0, used: 0, remaining: 0, credits: m ? m.credits || 0 : 0, creditsMonthly: m ? m.credits_monthly : null };
  }
  if (m.current_period_end && Date.parse(m.current_period_end) < Date.now()) {
    return { active: false, plan: m.plan, quota: m.leads_quota, used: m.leads_used, remaining: 0, credits: m.credits || 0, creditsMonthly: m.credits_monthly };
  }
  const quota = m.leads_quota; // null = unlimited
  const used = m.leads_used || 0;
  const remaining = quota === null ? null : Math.max(0, quota - used);
  return { active: true, plan: m.plan, quota, used, remaining, credits: m.credits || 0, creditsMonthly: m.credits_monthly };
}

// Increment leads_used after N new leads are persisted for a user. Safe no-op if
// the user has no membership row. Called from the data layer on insert.
async function consumeLeads(userId, n) {
  if (!n || n <= 0) return;
  await pool().query(
    `UPDATE memberships SET leads_used = leads_used + $1, updated_at = $2 WHERE user_id = $3`,
    [n, now(), userId]
  );
}

// Upsert a membership from a Whop webhook event (grant/renew). Resetting
// credits_renewed_at to NULL makes the next read grant the new plan's monthly
// credits immediately (handled by ensureCredits).
async function grantMembership({ userId, whopMembershipId, whopPlanId, periodStart, periodEnd, resetUsage = true }) {
  const plan = planFromWhopId(whopPlanId);
  const quota = quotaForPlan(plan);
  const ts = now();
  await pool().query(
    `INSERT INTO memberships (user_id, whop_membership_id, whop_plan_id, plan, status, leads_quota, leads_used, current_period_start, current_period_end, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, 0, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       whop_membership_id = EXCLUDED.whop_membership_id,
       whop_plan_id = EXCLUDED.whop_plan_id,
       plan = EXCLUDED.plan,
       status = 'active',
       leads_quota = EXCLUDED.leads_quota,
       leads_used = CASE WHEN $9 THEN 0 ELSE memberships.leads_used END,
       credits_renewed_at = NULL,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = EXCLUDED.updated_at`,
    [userId, whopMembershipId, whopPlanId, plan, quota, periodStart || null, periodEnd || null, ts, resetUsage]
  );
  // Apply the plan's monthly credits right away.
  await ensureCredits(userId);
}

// Stash a grant we couldn't link yet (no user_id metadata + no matching user),
// keyed by buyer email. Reconciled on that email's next sign-in.
async function queuePendingGrant({ email, whopMembershipId, whopPlanId, periodStart, periodEnd }) {
  if (!email) return;
  await pool().query(
    `INSERT INTO pending_grants (email, whop_membership_id, whop_plan_id, current_period_start, current_period_end, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email.toLowerCase(), whopMembershipId || null, whopPlanId || null, periodStart || null, periodEnd || null, now()]
  );
}

// On sign-in, apply any pending grant(s) for this email then clear them. Returns
// the number of grants applied. Safe to call on every sign-in.
async function reconcilePendingGrants(userId, email) {
  if (!userId || !email) return 0;
  const { rows } = await pool().query(
    `SELECT id, whop_membership_id, whop_plan_id, current_period_start, current_period_end
       FROM pending_grants WHERE email = $1 ORDER BY created_at ASC`,
    [email.toLowerCase()]
  );
  for (const g of rows) {
    await grantMembership({
      userId,
      whopMembershipId: g.whop_membership_id,
      whopPlanId: g.whop_plan_id,
      periodStart: g.current_period_start,
      periodEnd: g.current_period_end,
    });
  }
  if (rows.length) {
    await pool().query(`DELETE FROM pending_grants WHERE email = $1`, [email.toLowerCase()]);
  }
  return rows.length;
}

// Revoke (cancellation / expiry) by Whop membership id.
async function revokeMembershipByWhopId(whopMembershipId) {
  await pool().query(
    `UPDATE memberships SET status = 'inactive', updated_at = $1 WHERE whop_membership_id = $2`,
    [now(), whopMembershipId]
  );
}

// ---- Admin (manual) plan management -----------------------------------------
// Grant/change a plan for a user directly (not via Whop). Used by the admin
// panel. current_period_end is left NULL so the membership never auto-expires.
async function setPlanForUser(userId, plan, { resetUsage = true } = {}) {
  if (!["p19", "p35", "p49"].includes(plan)) throw new Error("Invalid plan");
  const quota = quotaForPlan(plan); // 5000 / 50000 / null(unlimited)
  const ts = now();
  await pool().query(
    `INSERT INTO memberships (user_id, whop_membership_id, whop_plan_id, plan, status, leads_quota, leads_used, current_period_start, current_period_end, updated_at)
     VALUES ($1, NULL, NULL, $2, 'active', $3, 0, $4, NULL, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       status = 'active',
       leads_quota = EXCLUDED.leads_quota,
       leads_used = CASE WHEN $5 THEN 0 ELSE memberships.leads_used END,
       credits_renewed_at = NULL,
       current_period_end = NULL,
       updated_at = EXCLUDED.updated_at`,
    [userId, plan, quota, ts, resetUsage]
  );
  await ensureCredits(userId); // grant the plan's monthly credits immediately
}

// Revoke a user's plan (admin downgrade to free). Credits are left untouched.
async function revokeForUser(userId) {
  await pool().query(
    `UPDATE memberships SET status = 'inactive', updated_at = $1 WHERE user_id = $2`,
    [now(), userId]
  );
}

// All users joined with their membership, for the admin panel.
async function listUsersWithEntitlement(limit = 500) {
  const { rows } = await pool().query(
    `SELECT u.id, u.email, u.name, u.image, u.created_at,
            m.plan, m.status, m.leads_quota, m.leads_used,
            m.credits, m.credits_monthly, m.current_period_end
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
      ORDER BY u.created_at DESC NULLS LAST, u.email ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  PLAN_QUOTAS,
  PLAN_PRICES,
  PLAN_CREDITS,
  PLAN_LABELS,
  REPORT_COST,
  AUDIT_COST,
  planFromWhopId,
  quotaForPlan,
  getSetting,
  setSetting,
  getFreeMonthlyConfig,
  setFreeMonthlyConfig,
  ensureCredits,
  getCredits,
  consumeCredits,
  addCredits,
  recordCreditTxn,
  listCreditTransactions,
  setUserCredits,
  setUserMonthlyCredits,
  getEntitlement,
  consumeLeads,
  grantMembership,
  revokeMembershipByWhopId,
  queuePendingGrant,
  reconcilePendingGrants,
  setPlanForUser,
  revokeForUser,
  listUsersWithEntitlement,
};
