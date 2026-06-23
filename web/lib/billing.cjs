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

// Unified single credit pool: every action spends from one `credits` balance.
// A plan's monthly grant == its credit allowance (p49 = unlimited / null).
const PLAN_QUOTAS = { p19: 5000, p35: 50000, p49: null }; // legacy alias, kept == PLAN_CREDITS
const PLAN_PRICES = { p19: 19, p35: 35, p49: 49 };
const PLAN_CREDITS = { p19: 5000, p35: 50000, p49: null }; // monthly credits (null = unlimited)
const PLAN_LABELS = { p19: "Starter", p35: "Growth", p49: "Scale" };
const LEAD_COST = 1; // credits per new lead captured
const REPORT_COST = 10; // credits per full website report (audit + AI + chatbot)
const AUDIT_COST = 3; // credits per quick audit (desktop + mobile Lighthouse scores only)
const CHATBOT_COST = 5; // credits per website chatbot/live-chat scan

// ---- per-day caps (separate from the monthly credit pool) -------------------
// Each plan limits how many searches (find requests) and how many leads can be
// pulled per calendar day. Defaults below; admins can override per plan via
// app_settings (plan_daily_searches_<id> / plan_daily_leads_<id>). A value of 0
// means "no daily limit" for that metric. Counters reset at local midnight in the
// admin-configured timezone (daily_reset_tz, default UTC).
const PLAN_DAILY_SEARCHES = { p19: 20, p35: 100, p49: 1000 };
const PLAN_DAILY_LEADS = { p19: 400, p35: 1500, p49: 5000 };
// Accounts with no active paid plan (free tier) — also admin-tunable.
const FREE_DAILY_SEARCHES = 5;
const FREE_DAILY_LEADS = 100;

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
    getSetting("free_monthly_credits", "300"),
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

// True when the user is on a plan whose credit grant is unlimited (p49). Such
// accounts never deduct and never track a numeric grant.
function isUnlimited(m) {
  return isPaidActive(m) && PLAN_CREDITS[m.plan] === null;
}

// What a user's monthly credit grant should be: a per-user override wins, then
// unlimited plans (null = no numeric grant), then the active paid plan's
// allotment, then the global free grant (if enabled). null = unlimited.
function effectiveMonthly(m, free) {
  if (m && m.credits_monthly != null) return Math.max(0, m.credits_monthly);
  if (isUnlimited(m)) return null;
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
    // Unlimited plans (grant === null) just stamp the renewal; no number tracked.
    const upd = grant == null
      ? await pool().query(
          `UPDATE memberships SET credits_renewed_at = $1, updated_at = $1
             WHERE user_id = $2 RETURNING *`,
          [ts, userId]
        )
      : await pool().query(
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
  const m = await ensureCredits(userId); // make sure the row + monthly grant exist first
  // Unlimited plans never deduct (and we skip the ledger to avoid per-lead spam).
  if (isUnlimited(m)) return { ok: true, unlimited: true, credits: m ? m.credits || 0 : 0 };
  if (n === 0) return { ok: true, credits: m ? m.credits || 0 : 0 };
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

// ---- per-day search + lead limits -------------------------------------------
// The IANA timezone the daily counters reset at (local midnight). Admin-tunable.
async function getResetTz() {
  const tz = await getSetting("daily_reset_tz", "UTC");
  return tz || "UTC";
}

// The day-key (YYYY-MM-DD) for an instant in a timezone. Falls back to UTC if the
// tz string is invalid so a bad setting can never throw on the hot path.
function tzDayKey(date, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// Seconds until the next local midnight in tz, that midnight as an ISO instant, and
// today's day-key. Used both to know which day the counters belong to and to tell
// the user when their limit resets.
function dailyResetInfo(tz) {
  const nowD = new Date();
  let secsLeft;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(nowD);
    const get = (t) => parseInt((parts.find((p) => p.type === t) || {}).value, 10) || 0;
    let h = get("hour");
    if (h >= 24) h = 0; // some engines render midnight as "24"
    secsLeft = 24 * 3600 - (h * 3600 + get("minute") * 60 + get("second"));
  } catch {
    secsLeft = 24 * 3600 - (nowD.getUTCHours() * 3600 + nowD.getUTCMinutes() * 60 + nowD.getUTCSeconds());
  }
  if (!(secsLeft > 0)) secsLeft = 1;
  return { resetAt: new Date(nowD.getTime() + secsLeft * 1000).toISOString(), secsLeft, dayKey: tzDayKey(nowD, tz) };
}

// Short human "Xh Ym" / "Ym" until reset, for server-side messages.
function formatResetIn(secsLeft) {
  const h = Math.floor(secsLeft / 3600);
  const m = Math.floor((secsLeft % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

// Resolve a plan's daily caps: a per-plan admin override (app_settings) wins, then
// the code default. plan == null/invalid uses the free tier. Returns integers where
// 0 == "no daily limit".
async function getDailyLimits(plan) {
  const key = plan && plan in PLAN_DAILY_SEARCHES ? plan : "free";
  const defSearch = key === "free" ? FREE_DAILY_SEARCHES : PLAN_DAILY_SEARCHES[key];
  const defLeads = key === "free" ? FREE_DAILY_LEADS : PLAN_DAILY_LEADS[key];
  const [sSet, lSet] = await Promise.all([
    getSetting(`plan_daily_searches_${key}`),
    getSetting(`plan_daily_leads_${key}`),
  ]);
  const num = (v, d) => (v != null && v !== "" ? Math.max(0, parseInt(v, 10) || 0) : d);
  return { searches: num(sSet, defSearch), leads: num(lSet, defLeads) };
}

// Shape one metric's usage: { limit, used, remaining, unlimited }. unlimited=true
// (remaining=null) when the cap is 0/disabled.
function dailyMetric(limit, used) {
  const unlimited = !limit || limit <= 0;
  return { limit, used, remaining: unlimited ? null : Math.max(0, limit - used), unlimited };
}

// Read-only daily usage snapshot for a user (applies the day-reset on read WITHOUT
// mutating the row). Returns { plan, tz, resetAt, resetInSeconds, searches, leads }.
async function getDailyUsage(userId) {
  const m = await ensureCredits(userId);
  const tz = await getResetTz();
  const info = dailyResetInfo(tz);
  const plan = isPaidActive(m) ? m.plan : null;
  const limits = await getDailyLimits(plan);
  const sameDay = m && m.daily_date === info.dayKey;
  const usedSearches = sameDay ? m.searches_today || 0 : 0;
  const usedLeads = sameDay ? m.leads_today || 0 : 0;
  return {
    plan: plan || null,
    tz,
    resetAt: info.resetAt,
    resetInSeconds: info.secsLeft,
    searches: dailyMetric(limits.searches, usedSearches),
    leads: dailyMetric(limits.leads, usedLeads),
  };
}

// Atomically count one search against the daily cap. Resets the per-day counters
// when the day rolled over (in the configured tz). Returns { ok, used, limit,
// remaining, unlimited, resetAt, resetInSeconds }. ok=false (without counting) when
// the cap is already hit — the conditional UPDATE makes this race-safe across
// concurrent requests so it can't be bypassed by firing many at once.
async function consumeDailySearch(userId) {
  const m = await ensureCredits(userId);
  const tz = await getResetTz();
  const info = dailyResetInfo(tz);
  const plan = isPaidActive(m) ? m.plan : null;
  const { searches: limit } = await getDailyLimits(plan);
  const ts = now();
  const base = { limit, unlimited: !limit || limit <= 0, resetAt: info.resetAt, resetInSeconds: info.secsLeft };

  // The CASE rolls the counter to 0 when daily_date no longer matches today.
  const setClause = `
        searches_today = (CASE WHEN daily_date = $2 THEN searches_today ELSE 0 END) + 1,
        leads_today = CASE WHEN daily_date = $2 THEN leads_today ELSE 0 END,
        daily_date = $2, updated_at = $3`;

  if (base.unlimited) {
    await pool().query(`UPDATE memberships SET ${setClause} WHERE user_id = $1`, [userId, info.dayKey, ts]);
    return { ok: true, used: null, remaining: null, ...base };
  }
  const { rows } = await pool().query(
    `UPDATE memberships SET ${setClause}
       WHERE user_id = $1 AND (CASE WHEN daily_date = $2 THEN searches_today ELSE 0 END) < $4
       RETURNING searches_today`,
    [userId, info.dayKey, ts, limit]
  );
  if (!rows[0]) return { ok: false, used: limit, remaining: 0, ...base };
  const used = rows[0].searches_today;
  return { ok: true, used, remaining: Math.max(0, limit - used), ...base };
}

// Give back a search we counted but couldn't fulfil (e.g. the warehouse was down),
// so a failed request doesn't burn the user's daily allowance. Same-day only.
async function releaseDailySearch(userId) {
  const tz = await getResetTz();
  const info = dailyResetInfo(tz);
  await pool().query(
    `UPDATE memberships SET searches_today = GREATEST(0, searches_today - 1), updated_at = $3
       WHERE user_id = $1 AND daily_date = $2 AND searches_today > 0`,
    [userId, info.dayKey, now()]
  );
}

// Count delivered leads against the daily cap (best-effort, called after a find
// returns). Resets on day change. Does NOT enforce — the caller caps the request
// by the remaining daily allowance first.
async function addDailyLeads(userId, n) {
  n = Math.max(0, Math.floor(n || 0));
  if (!n) return;
  const tz = await getResetTz();
  const info = dailyResetInfo(tz);
  await pool().query(
    `UPDATE memberships
        SET leads_today = (CASE WHEN daily_date = $2 THEN leads_today ELSE 0 END) + $4,
            searches_today = CASE WHEN daily_date = $2 THEN searches_today ELSE 0 END,
            daily_date = $2, updated_at = $3
      WHERE user_id = $1`,
    [userId, info.dayKey, now(), n]
  );
}

// ---- entitlement ------------------------------------------------------------
// Current entitlement for a user: { active, plan, quota, used, remaining, credits,
// creditsMonthly }. remaining === null means unlimited. active=false when no/expired
// membership (credits still work for free accounts).
async function getEntitlement(userId) {
  const m = await ensureCredits(userId); // also lazily creates the row + grants monthly
  const credits = m ? m.credits || 0 : 0;
  const creditsMonthly = m ? m.credits_monthly : null;
  // Inactive / no plan: the single credit balance is still spendable (free grant).
  // remaining mirrors credits so the find gate lets free users spend what they have.
  if (!m || m.status !== "active" || (m.current_period_end && Date.parse(m.current_period_end) < Date.now())) {
    return {
      active: false, plan: m && m.status === "active" ? m.plan : null, unlimited: false,
      credits, monthly: creditsMonthly, creditsMonthly,
      quota: 0, used: 0, remaining: credits,
    };
  }
  const unlimited = isUnlimited(m);
  const free = await getFreeMonthlyConfig();
  const monthly = effectiveMonthly(m, free); // null = unlimited
  return {
    active: true, plan: m.plan, unlimited,
    credits, monthly, creditsMonthly,
    // Back-compat aliases (existing UI reads these): the credit balance is now
    // the spendable number; remaining === null means unlimited.
    quota: monthly, used: monthly != null ? Math.max(0, monthly - credits) : 0,
    remaining: unlimited ? null : credits,
  };
}

// Spend 1 credit per newly-persisted lead (unified pool). Called from the data
// layer on insert. Unlimited plans are a no-op inside consumeCredits. Safe no-op
// when n <= 0; the find route caps requests by available credits so this succeeds.
async function consumeLeads(userId, n, meta = {}) {
  if (!n || n <= 0) return;
  await consumeCredits(userId, n * LEAD_COST, { reason: "leads", count: n, project: meta.project });
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
    `SELECT u.id, u.email, u.name, u.image, u.created_at, u.banned,
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

// Admin: who's currently logged in. Auth.js stores DB sessions in `sessions`;
// a user is "online" if they hold at least one non-expired session.
async function listActiveSessions(limit = 200) {
  const { rows } = await pool().query(
    `SELECT u.id, u.email, u.name, u.image, u.banned,
            COUNT(*)::int AS sessions,
            MAX(s.expires) AS expires,
            m.plan, m.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = u.id
      WHERE s.expires > now()
      GROUP BY u.id, u.email, u.name, u.image, u.banned, m.plan, m.status
      ORDER BY expires DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ---- Admin: account ban + package pricing ------------------------------------
// Ban (suspend) or unban a user account. requireUser() blocks banned users.
async function setUserBanned(userId, banned) {
  await pool().query(`UPDATE users SET banned = $1 WHERE id = $2`, [banned ? 1 : 0, userId]);
  return !!banned;
}

// Cheap ban check on the request hot path (PK lookup).
async function isBanned(userId) {
  if (!userId) return false;
  try {
    const { rows } = await pool().query(`SELECT banned FROM users WHERE id = $1`, [userId]);
    return !!(rows[0] && rows[0].banned);
  } catch {
    return false; // never lock everyone out if the column/query hiccups
  }
}

const PLAN_IDS = ["p19", "p35", "p49"];

// The packages as the public billing page / admin should display them: plan
// constants with any admin price/credits/daily-limit override from app_settings
// applied. dailySearches/dailyLeads default to the code constants (0 = unlimited).
async function getPackages() {
  const pkgs = [];
  for (const id of PLAN_IDS) {
    const daily = await getDailyLimits(id);
    pkgs.push({
      id,
      label: PLAN_LABELS[id],
      price: PLAN_PRICES[id],
      quota: PLAN_QUOTAS[id],
      credits: PLAN_CREDITS[id],
      dailySearches: daily.searches,
      dailyLeads: daily.leads,
    });
  }
  for (const p of pkgs) {
    const pr = await getSetting(`plan_price_${p.id}`);
    if (pr != null && pr !== "") p.price = Math.max(0, parseInt(pr, 10) || 0);
    const cr = await getSetting(`plan_credits_${p.id}`);
    if (cr != null && cr !== "") p.credits = Math.max(0, parseInt(cr, 10) || 0);
  }
  return pkgs;
}

// Admin: override a package's monthly price, credit grant, and/or daily limits.
async function setPackage(id, { price, credits, dailySearches, dailyLeads } = {}) {
  if (!PLAN_IDS.includes(id)) throw new Error("Invalid package");
  const setNum = async (val, key) => {
    if (val !== undefined && val !== null && val !== "") {
      await setSetting(key, Math.max(0, parseInt(val, 10) || 0));
    }
  };
  await setNum(price, `plan_price_${id}`);
  await setNum(credits, `plan_credits_${id}`);
  await setNum(dailySearches, `plan_daily_searches_${id}`);
  await setNum(dailyLeads, `plan_daily_leads_${id}`);
  return (await getPackages()).find((p) => p.id === id);
}

module.exports = {
  PLAN_QUOTAS,
  PLAN_PRICES,
  PLAN_CREDITS,
  PLAN_LABELS,
  LEAD_COST,
  REPORT_COST,
  AUDIT_COST,
  CHATBOT_COST,
  isUnlimited,
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
  // daily search + lead limits
  PLAN_DAILY_SEARCHES,
  PLAN_DAILY_LEADS,
  getResetTz,
  dailyResetInfo,
  formatResetIn,
  getDailyLimits,
  getDailyUsage,
  consumeDailySearch,
  releaseDailySearch,
  addDailyLeads,
  grantMembership,
  revokeMembershipByWhopId,
  queuePendingGrant,
  reconcilePendingGrants,
  setPlanForUser,
  revokeForUser,
  listUsersWithEntitlement,
  listActiveSessions,
  setUserBanned,
  isBanned,
  getPackages,
  setPackage,
};
