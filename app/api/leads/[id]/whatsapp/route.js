import db from "../../../../../web/lib/db.cjs";
import waLib from "../../../../../whatsapp.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// On-demand single-lead WhatsApp check: normalize this lead's phone and ask the
// OpenWA instance whether it's registered, then persist the result. Returns the
// updated lead so the table can refresh that one row in place.
export async function POST(request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.phone) return Response.json({ error: "This lead has no phone to check" }, { status: 400 });

  // A bare local number (e.g. US "(866) 432-3187") needs a country code before
  // WhatsApp can resolve it. Prefer an explicit country (the active filter the
  // user picked in the UI), then fall back to the lead's own parsed country.
  const overrideCountry = new URL(request.url).searchParams.get("country") || "";
  const cc = waLib.dialingCode(overrideCountry) || waLib.dialingCode(lead.country);
  const number = waLib.normalizePhone(lead.phone, cc);
  if (!number) {
    const updated = await db.updateLeadFields(userId, id, { whatsapp_status: "no phone" });
    return Response.json({ lead: updated });
  }

  try {
    const r = await waLib.checkNumber(number);
    const updated = await db.updateLeadFields(userId, id, {
      whatsapp_status: r.status,
      whatsapp_id: r.whatsappId,
    });
    return Response.json({ lead: updated });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
