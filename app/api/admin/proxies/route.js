import db from "../../../../web/lib/db.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only: manage the global scraper proxy pool.
//   GET    /api/admin/proxies                 -> { proxies: [...] }
//   POST   /api/admin/proxies { urls }         -> bulk add (one per line/comma)
//   PATCH  /api/admin/proxies { id, enabled }  -> enable/disable a proxy
//   DELETE /api/admin/proxies { id }           -> remove a proxy
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  return Response.json({ proxies: await db.listProxies() });
}

export async function POST(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const { added, total } = await db.addProxies(body.urls || "");
  return Response.json({ ok: true, added, total, proxies: await db.listProxies() });
}

export async function PATCH(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
  await db.setProxyEnabled(body.id, !!body.enabled);
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const { response } = await requireAdmin();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
  await db.deleteProxy(body.id);
  return Response.json({ ok: true });
}
