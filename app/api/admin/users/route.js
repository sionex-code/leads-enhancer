import billing from "../../../../web/lib/billing.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: list all users with their membership, and change a user's plan.
//   GET  /api/admin/users                      -> { users: [...] }
//   POST /api/admin/users { userId, plan }      -> grant p19|p35|p49, or revoke
//      (plan = null | "" | "free" downgrades the user to no plan)
//   Plan keys MUST match billing.cjs: p19 Starter · p35 Growth · p49 Scale.
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  const users = await billing.listUsersWithEntitlement();
  return Response.json({ users });
}

export async function POST(request) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const { userId, plan } = body || {};
  if (!userId) return Response.json({ error: "userId is required" }, { status: 400 });

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
