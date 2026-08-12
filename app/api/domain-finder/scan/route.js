import db from "../../../../web/lib/db.cjs";
import billing from "../../../../web/lib/billing.cjs";
import trackingDetect from "../../../../web/lib/tracking-detect.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Hard ceiling per scan, independent of what the client claims to have
// crawled. The extension runs in the user's own browser, so its output is
// untrusted input just like the Maps live-search ingest path.
const MAX_ROWS_PER_SCAN = 200;

const SOCIAL_KEYS = ["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest", "whatsapp"];

function normalizeDomain(raw) {
  let s = String(raw || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  return s;
}

// Map one extension-crawled row onto the lead shape db.bulkSaveLeads expects.
function toLeadRow(x, ctx) {
  const domain = normalizeDomain(x.domain);
  const website = `https://${domain}`;
  const row = {
    name: domain,
    website,
    domain,
    email: String(x.email || ""),
    all_emails: String(x.all_emails || ""),
    contact_page: String(x.contact_page || ""),
    enrich_status: x.status === "ok" ? "ok" : x.status === "timeout" ? "timeout (10s)" : "error",
    source: "domain_finder",
    project: ctx.project,
  };
  for (const k of SOCIAL_KEYS) row[k] = String(x[k] || "");
  // scanned:true whenever we actually got the HTML (status "ok"), so a clean
  // site (no pixels found) reads as "scanned, nothing there" not "unscanned".
  row.tech = trackingDetect.serialize(x.tech, { scanned: x.status === "ok" });
  if (row.tech) row.tech_checked_at = new Date().toISOString();
  return row;
}

// POST /api/domain-finder/scan
// Accepts domains crawled by the browser extension's ENRICH_DOMAINS job and
// stores them as a distinct lead category (source: 'domain_finder').
export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const incoming = Array.isArray(body?.rows) ? body.rows : null;
  if (!incoming) return Response.json({ error: "rows[] is required" }, { status: 400 });

  const project = String(body.project || "").trim().slice(0, 80) || "Domain Finder";
  const ctx = { project };

  const rows = incoming
    .filter((r) => r && normalizeDomain(r.domain))
    .slice(0, MAX_ROWS_PER_SCAN)
    .map((r) => toLeadRow(r, ctx));

  if (!rows.length) {
    return Response.json({ error: "No valid domains in the scan results" }, { status: 400 });
  }

  // Charge up front, same posture as the Maps live-search ingest path: the
  // crawl already happened for free in the user's browser, but saving the
  // lead is still metered like any other captured lead.
  const entitlement = await billing.getEntitlement(userId);
  const avail = entitlement.unlimited ? Infinity : entitlement.credits || 0;
  if (!entitlement.unlimited && avail < rows.length) {
    return Response.json(
      {
        error: `Not enough credits: saving ${rows.length} domain(s) needs ${rows.length} credits and you have ${avail}.`,
        code: "insufficient_credits",
        cost: rows.length,
        credits: avail,
      },
      { status: 402 }
    );
  }

  const saved = await db.bulkSaveLeads(userId, rows);
  const inserted = saved.filter(Boolean).length;

  return Response.json({
    ok: true,
    received: incoming.length,
    stored: rows.length,
    saved: inserted,
    leads: saved,
  });
}
