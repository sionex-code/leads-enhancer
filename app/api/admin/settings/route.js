import settings from "../../../../web/lib/settings.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_MODES = ["warehouse", "warehouse_fallback"];

// GET /api/admin/settings  -> { lead_source_mode }
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const mode = await settings.getLeadSourceMode();
  return Response.json({ lead_source_mode: mode });
}

// POST /api/admin/settings { lead_source_mode } -> { lead_source_mode }
export async function POST(request) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const { lead_source_mode } = body || {};

  if (!VALID_MODES.includes(lead_source_mode)) {
    return Response.json(
      { error: `lead_source_mode must be one of: ${VALID_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  const saved = await settings.setSetting("lead_source_mode", lead_source_mode);
  return Response.json({ lead_source_mode: saved });
}
