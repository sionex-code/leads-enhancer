import billing from "../../../../web/lib/billing.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: list all users, change a user's plan, adjust their credit balance,
// or ban/unban them.
//   GET  /api/admin/users                                  -> { users: [...] }
//   POST /api/admin/users { userId, plan }                  -> grant p19|p35|p49 or revoke
//   POST /api/admin/users { userId, action:"credits", mode:"add"|"set", amount }
//   POST /api/admin/users { userId, action:"ban", banned:true|false }
//   Plan keys MUST match billing.cjs: p19 Starter · p35 Growth · p49 Scale.
export async function GET(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  // GET /api/admin/users?history=<userId>&page=N -> that user's credit ledger.
  const { searchParams } = new URL(request.url);
  const historyUser = searchParams.get("history");
  if (historyUser) {
    const page = Math.max(1, parseInt(searchParams.get("page"), 10) || 1);
    const pageSize = 12;
    const { rows, total } = await billing.listCreditTransactions(historyUser, { limit: pageSize, offset: (page - 1) * pageSize });
    return Response.json({ rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });
  }
  const users = await billing.listUsersWithEntitlement();
  return Response.json({ users });
}

export async function POST(request) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const { userId, action, plan } = body || {};
  if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });

  // Adjust credit balance: add/remove a delta, or set an absolute amount.
  if (action === "credits") {
    const amount = Math.trunc(Number(body.amount) || 0);
    let credits;
    if (body.mode === "set") {
      credits = await billing.setUserCredits(userId, Math.max(0, amount));
      await billing.recordCreditTxn(userId, { delta: 0, reason: "admin", balanceAfter: credits });
    } else {
      credits = await billing.addCredits(userId, amount, { reason: "admin" });
    }
    return Response.json({ ok: true, credits });
  }

  // Ban / unban the account.
  if (action === "ban") {
    const banned = await billing.setUserBanned(userId, !!body.banned);
    return Response.json({ ok: true, banned });
  }

  // Default: plan management.
  if (plan === null || plan === "" || plan === "free") {
    await billing.revokeForUser(userId);
  } else if (["p19", "p35", "p49"].includes(plan)) {
    await billing.setPlanForUser(userId, plan);
  } else {
    return Response.json({ error: "Invalid plan" }, { status: 400 });
  }

  const entitlement = await billing.getEntitlement(userId);
  return Response.json({ ok: true, entitlement });
}
