import settings from "../../../../web/lib/settings.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { requireAdmin } from "../../../../web/lib/admin-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_MODES = ["warehouse", "warehouse_fallback"];

// Validate an IANA timezone string is one this runtime understands.
function isValidTz(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// GET /api/admin/settings  -> { lead_source_mode, daily_reset_tz }
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const [mode, daily_reset_tz] = await Promise.all([
    settings.getLeadSourceMode(),
    billing.getResetTz(),
  ]);
  return Response.json({ lead_source_mode: mode, daily_reset_tz });
}

// POST /api/admin/settings { lead_source_mode? , daily_reset_tz? }
export async function POST(request) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const { lead_source_mode, daily_reset_tz } = body || {};

  if (lead_source_mode !== undefined) {
    if (!VALID_MODES.includes(lead_source_mode)) {
      return Response.json(
        { error: `lead_source_mode must be one of: ${VALID_MODES.join(", ")}` },
        { status: 400 }
      );
    }
    await settings.setSetting("lead_source_mode", lead_source_mode);
  }

  if (daily_reset_tz !== undefined) {
    if (!isValidTz(daily_reset_tz)) {
      return Response.json({ error: "daily_reset_tz must be a valid IANA timezone (e.g. UTC, Asia/Karachi)." }, { status: 400 });
    }
    await settings.setSetting("daily_reset_tz", daily_reset_tz);
  }

  const [mode, tz] = await Promise.all([settings.getLeadSourceMode(), billing.getResetTz()]);
  return Response.json({ lead_source_mode: mode, daily_reset_tz: tz });
}
