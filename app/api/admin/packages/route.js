import billing from "../../../../web/lib/billing.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: view + update package pricing.
//   GET  /api/admin/packages                              -> { packages: [...] }
//   POST /api/admin/packages { id, price?, credits? }      -> update one package
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  const packages = await billing.getPackages();
  return Response.json({ packages });
}

export async function POST(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "Package id is required" }, { status: 400 });
  try {
    const pkg = await billing.setPackage(body.id, {
      price: body.price,
      credits: body.credits,
      dailySearches: body.dailySearches,
      dailyLeads: body.dailyLeads,
    });
    return Response.json({ ok: true, package: pkg });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 400 });
  }
}
