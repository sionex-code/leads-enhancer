import store from "../../../../web/lib/crm/store.cjs";
import crm from "../../../../web/lib/crm/index.cjs";
import runner from "../../../../web/lib/crm/runner.cjs";
import target from "../../../../web/lib/crm/target.cjs";
import billing from "../../../../web/lib/billing.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hard ceiling on one push. Not a billing limit - just a bound on how much work
// a single click can queue.
const MAX_PUSH = 2000;

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

  // Per-push settings. Only fields the adapter marked `pushOverride` may be set,
  // and a `select` may only take one of its own option values - this lands in
  // the job row and is forwarded to a third-party API, so it is an allowlist on
  // both the key and the value, never a spread of whatever the client sent.
  const configOverride = {};
  for (const field of (adapter.configFields || []).filter((f) => f.pushOverride)) {
    const raw = body.configOverride?.[field.key];
    if (raw == null) continue;
    const value = String(raw);
    if (field.type === "select" && !(field.options || []).some((o) => o.value === value)) continue;
    if (value !== String(connection.config?.[field.key] ?? field.default ?? "")) configOverride[field.key] = value;
  }

  const mode = target.modeOf(body);
  const resolved = await target.resolveLeadIds(userId, body, MAX_PUSH);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 400 });
  const leadIds = resolved.leadIds;

  if (!leadIds.length) return Response.json({ error: "No leads matched - nothing to send." }, { status: 400 });

  const job = await store.createJob(userId, {
    connectionId: connection.id,
    mode,
    source: {
      ...(body.filters || {}),
      list: body.list || null,
      skipUnchanged: body.skipUnchanged !== false,
      ...(Object.keys(configOverride).length ? { configOverride } : {}),
    },
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
