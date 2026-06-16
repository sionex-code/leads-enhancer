import db from "../../../../../web/lib/db.cjs";
import enrichLib from "../../../../../modules/enrich/index.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// On-demand single-lead enrichment: crawl this lead's website for an email +
// social links (same engine as the batch pipeline) and persist the result.
// Returns the updated lead so the table can refresh that one row in place.
export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.website) return Response.json({ error: "This lead has no website to enrich" }, { status: 400 });

  try {
    const r = await enrichLib.enrichSite(lead.website);
    const updated = await db.updateLeadFields(userId, id, {
      email: r.email,
      all_emails: r.allEmails,
      contact_page: r.contactPage,
      facebook: r.facebook,
      instagram: r.instagram,
      linkedin: r.linkedin,
      twitter: r.twitter,
      youtube: r.youtube,
      tiktok: r.tiktok,
      pinterest: r.pinterest,
      whatsapp: r.whatsapp,
      telegram: r.telegram,
      enrich_status: r.enrichStatus,
    });
    return Response.json({ lead: updated });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
