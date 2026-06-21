import billing from "../../../../web/lib/billing.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: everyone with a live Auth.js session right now ("who's logged in").
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  const sessions = await billing.listActiveSessions();
  return Response.json({ sessions });
}
