import warehouse from "../../../web/lib/warehouse.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// GET /api/catalog -> { countries, services }
// Returns the warehouse catalog (countries + service categories) so the
// "Find leads" form can render location/service pickers without a full scrape.
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  try {
    const data = await warehouse.catalog();
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { countries: [], services: [], error: e.message },
      { status: 200 }
    );
  }
}
