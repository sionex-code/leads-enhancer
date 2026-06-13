import db from "../../../../../web/lib/db.cjs";
import waLib from "../../../../../whatsapp.cjs";

export const dynamic = "force-dynamic";

// On-demand single-lead WhatsApp check: normalize this lead's phone and ask the
// OpenWA instance whether it's registered, then persist the result. Returns the
// updated lead so the table can refresh that one row in place.
export async function POST(_request, context) {
  const { id } = await context.params;
  const lead = db.getLead(id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.phone) return Response.json({ error: "This lead has no phone to check" }, { status: 400 });

  const number = waLib.normalizePhone(lead.phone);
  if (!number) {
    const updated = db.updateLeadFields(id, { whatsapp_status: "no phone" });
    return Response.json({ lead: updated });
  }

  try {
    const r = await waLib.checkNumber(number);
    const updated = db.updateLeadFields(id, {
      whatsapp_status: r.status,
      whatsapp_id: r.whatsappId,
    });
    return Response.json({ lead: updated });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
