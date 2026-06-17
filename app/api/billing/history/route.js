import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Paginated credit-spend history for the signed-in user. ?page=1&pageSize=20.
export async function GET(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { searchParams } = new URL(request.url);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 20)));
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const { rows, total } = await billing.listCreditTransactions(userId, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return Response.json({ rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });
}
