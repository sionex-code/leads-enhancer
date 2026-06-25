import db from "../../../../../web/lib/db.cjs";
import { fetchDomainRating, ahrefsSiteUrl } from "../../../../../web/lib/ahrefs.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Bulk Ahrefs Domain Rating. Body: { ids: number[] }.
// The free public endpoint is rate-limited, so we throttle to a small
// concurrency (one in-flight at a time per worker, 3 workers) and short-circuit
// on a single transient 429/5xx by returning the result so far.
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return Response.json({ error: "No leads selected" }, { status: 400 });

  const fetched = await Promise.all(ids.map((id) => db.getLead(userId, id)));
  const leads = fetched.filter((l) => l && (l.website || l.domain));
  const now = () => new Date().toISOString();
  const results = [];
  const errors = [];

  const CONCURRENCY = 3;
  let i = 0;
  async function worker() {
    while (i < leads.length) {
      const lead = leads[i++];
      const r = await fetchDomainRating(lead.website || lead.domain);
      if (!r.ok) {
        errors.push({ id: lead.id, error: r.error, target: r.target });
        results.push({ id: lead.id, error: r.error, target: r.target });
        continue;
      }
      const updated = await db.updateLeadScan(userId, lead.id, {
        domain_rating: r.domain_rating,
        domain_rating_checked_at: now(),
      });
      results.push({
        ...updated,
        ahrefs_url: ahrefsSiteUrl(r.target),
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, leads.length) }, worker));

  return Response.json({
    ok: true,
    count: results.length,
    succeeded: results.filter((r) => r.domain_rating != null).length,
    failed: errors.length,
    leads: results,
  });
}
