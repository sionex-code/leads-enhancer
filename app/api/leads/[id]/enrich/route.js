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
    // Already enriched by anyone? Reuse the shared cache instead of re-crawling —
    // the business's email/socials show instantly with no second website check.
    const cached = await db.getCachedEnrichment({ domain: lead.domain, website: lead.website, phone: lead.phone });
    if (cached && cached.email) {
      const updated = await db.updateLeadFields(userId, id, {
        email: cached.email,
        all_emails: cached.all_emails,
        contact_page: cached.contact_page,
        facebook: cached.facebook,
        instagram: cached.instagram,
        linkedin: cached.linkedin,
        twitter: cached.twitter,
        youtube: cached.youtube,
        tiktok: cached.tiktok,
        pinterest: cached.pinterest,
        whatsapp: cached.whatsapp,
        telegram: cached.telegram,
        enrich_status: cached.enrich_status || "ok (cached)",
      });
      return Response.json({ lead: updated, cached: true });
    }

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
    // Persist the fresh result to the shared cache for everyone else.
    await db.saveCachedEnrichment({ domain: lead.domain, website: lead.website, phone: lead.phone, ...r, source: "enrich" });
    return Response.json({ lead: updated });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
