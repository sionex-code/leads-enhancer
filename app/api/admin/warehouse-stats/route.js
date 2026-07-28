import warehouse from "../../../../web/lib/warehouse-pg.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: how much scraped data the warehouse holds, by country and city.
//   GET /api/admin/warehouse-stats -> { total, countries: [...], cities: [...] }
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const stats = await warehouse.getStats();
    return Response.json(stats);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503 });
  }
}
