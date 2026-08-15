import db from "../../../../web/lib/db.cjs";
import store from "../../../../web/lib/crm/store.cjs";
import crm from "../../../../web/lib/crm/index.cjs";
import runner from "../../../../web/lib/crm/runner.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hard ceiling on one push. Not a billing limit - just a bound on how much work
// a single click can queue.
const MAX_PUSH = 2000;

// The same filter names /api/leads/export reads, so "send what I'm looking at"
// means exactly what "export what I'm looking at" means.
function filtersFrom(source = {}) {
  const str = (k) => String(source[k] ?? "");
  return {
    search: str("search"),
    hasEmail: str("hasEmail"),
    hasWhatsapp: str("hasWhatsapp"),
    hasWebsite: str("hasWebsite"),
    hasPhone: source.hasPhone === "yes" ? "yes" : source.hasPhone === "no" ? "no" : "",
    reviews: str("reviews"),
    rating: str("rating"),
    social: str("social"),
    enriched: str("enriched"),
    httpStatus: str("httpStatus"),
    minScore: Number(source.minScore || 0),
    project: str("project"),
    country: str("country"),
    city: str("city"),
    workflow: str("workflow"),
    emailStatus: str("emailStatus"),
    outreachStatus: str("outreachStatus"),
    watchlist: source.watchlist === "1" || source.watchlist === true,
    contactList: source.contactList === "1" || source.contactList === true,
    list: str("list"),
    source: str("source"),
  };
}

export async function GET(request) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { searchParams } = new URL(request.url);
  const jobs = await store.listJobs(userId, {
    limit: Number(searchParams.get("limit") || 20),
    connectionId: searchParams.get("connectionId") || null,
  });
  return Response.json({ jobs });
}

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const connection = await store.getConnection(userId, body.connectionId);
  if (!connection) return Response.json({ error: "Pick an integration to send to." }, { status: 400 });
  if (connection.status === "error") {
    return Response.json(
      { error: `"${connection.label}" needs reconnecting before it can receive leads.`, code: "connection_error" },
      { status: 409 }
    );
  }

  // A campaign tool with no campaign chosen would fail identically on every
  // lead. Say it once, here, instead of 500 times in the failure drawer.
  const adapter = crm.get(connection.provider);
  const missing = (adapter?.configFields || []).find((f) => f.required && !connection.config?.[f.key]);
  if (missing) {
    return Response.json(
      { error: `Choose a ${missing.label.toLowerCase()} for "${connection.label}" in Integrations first.`, code: "connection_incomplete" },
      { status: 409 }
    );
  }

  // Sending a customer's leads into their CRM is a paid capability. Gated on
  // the plan rather than metered in credits: a push costs one HTTP request, and
  // charging per lead would mean refunding partial failures.
  const entitlement = await billing.getEntitlement(userId);
  if (!entitlement?.active) {
    return Response.json(
      { error: "Sending leads to a CRM is available on a paid plan.", code: "plan_required" },
      { status: 403 }
    );
  }

  const mode = body.mode === "ids" || body.mode === "list" || body.mode === "filters" ? body.mode : "ids";
  let leadIds = [];

  if (mode === "ids") {
    leadIds = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite))].slice(0, MAX_PUSH);
  } else if (mode === "list") {
    if (!body.list) return Response.json({ error: "Pick a list to send." }, { status: 400 });
    leadIds = await db.queryLeadIds(userId, { ...filtersFrom({}), list: String(body.list) }, MAX_PUSH);
  } else {
    leadIds = await db.queryLeadIds(userId, filtersFrom(body.filters || {}), MAX_PUSH);
  }

  if (!leadIds.length) return Response.json({ error: "No leads matched - nothing to send." }, { status: 400 });

  const job = await store.createJob(userId, {
    connectionId: connection.id,
    mode,
    source: { ...(body.filters || {}), list: body.list || null, skipUnchanged: body.skipUnchanged !== false },
    leadIds,
  });

  // Not awaited - the push outlives this request.
  runner.kick(job.id);

  return Response.json(
    {
      jobId: job.id,
      total: job.total,
      connection: { id: connection.id, label: connection.label, provider: connection.provider },
    },
    { status: 202 }
  );
}
