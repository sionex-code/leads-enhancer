import db from "../../../../../web/lib/db.cjs";
import { fetchDomainRating, ahrefsSiteUrl } from "../../../../../web/lib/ahrefs.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Fetch and persist Ahrefs Domain Rating (free, no API key) for a single lead.
// Always overwrites whatever was previously cached; the lead row keeps the
// timestamp so callers can decide when to refresh.
export async function POST(_request, context) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await context.params;
  const lead = await db.getLead(userId, id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.website && !lead.domain) {
    return Response.json({ error: "This lead has no website" }, { status: 400 });
  }

  const target = lead.website || lead.domain;
  const r = await fetchDomainRating(target);
  if (!r.ok) {
    return Response.json({ error: r.error || "Could not fetch Domain Rating", target: r.target, lead }, { status: 502 });
  }
  const updated = await db.updateLeadScan(userId, id, {
    domain_rating: r.domain_rating,
    domain_rating_checked_at: new Date().toISOString(),
  });
  return Response.json({
    lead: updated,
    target: r.target,
    domain_rating: r.domain_rating,
    ahrefs_url: ahrefsSiteUrl(r.target),
  });
}
