import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/billing/plans -> { packages: [{ id, label, price, credits, dailySearches,
// dailyLeads }], tz }. The public-facing view of the plans (with any admin price /
// credit / daily-limit overrides applied) so the billing page can show live limits.
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const [packages, tz] = await Promise.all([billing.getPackages(), billing.getResetTz()]);
  return Response.json({ packages, tz });
}
