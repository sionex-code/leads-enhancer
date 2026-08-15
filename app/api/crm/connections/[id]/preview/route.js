import db from "../../../../../../web/lib/db.cjs";
import store from "../../../../../../web/lib/crm/store.cjs";
import crm from "../../../../../../web/lib/crm/index.cjs";
import mapping from "../../../../../../web/lib/crm/mapping.cjs";
import target from "../../../../../../web/lib/crm/target.cjs";
import { requireUser } from "../../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// How many of the selected leads to actually inspect. Enough to make "213 of
// these have no email" true rather than extrapolated, cheap enough to run while
// a dialog is open.
const SAMPLE = 500;

// The exact payload one real lead would produce, so a user can check the
// mapping before sending 500 of them. No credentials are touched and nothing
// leaves the server.
export async function POST(request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  const connection = await store.getConnection(userId, id);
  if (!connection) return Response.json({ error: "Integration not found." }, { status: 404 });
  const adapter = crm.get(connection.provider);
  if (!adapter) return Response.json({ error: "Unknown integration type." }, { status: 400 });

  const body = await request.json().catch(() => ({}));

  const fieldMap = body.fieldMap?.length ? body.fieldMap : (connection.field_map?.length ? connection.field_map : adapter.defaultFieldMap);
  const valid = mapping.validateFieldMap(fieldMap, adapter);
  if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });

  // Preview the leads that are actually about to be sent. Sampling the account
  // at large instead would warn about empty fields on a lead nobody selected -
  // which reads as "your data is missing" when the data is fine.
  let leads = [];
  if (body.leadId) {
    const one = await db.getLead(userId, body.leadId);
    leads = one ? [one] : [];
  } else if (body.mode) {
    const resolved = await target.resolveLeads(userId, body, SAMPLE);
    if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 400 });
    leads = resolved.leads;
  } else {
    const { rows } = await db.queryLeads(userId, { limit: 1 });
    leads = rows?.[0] ? [rows[0]] : [];
  }
  if (!leads.length) return Response.json({ error: "No leads matched - nothing to preview." }, { status: 400 });

  const mappedAll = leads.map((lead) => mapping.applyFieldMap(lead, valid.map));

  // Show a lead that actually carries the required fields, so the example is a
  // representative payload rather than an accident of ordering. The warnings
  // below carry the gaps, counted across the whole selection.
  const required = (adapter.mappableFields || []).filter((f) => f.required).map((f) => f.key);
  let at = mappedAll.findIndex((m) => required.every((k) => m[k]));
  if (at < 0) at = 0;

  // Which mapped fields come out empty, and for how many of the selected leads
  // - the usual reason a CRM later rejects a row, and much cheaper to notice
  // here than in the failure drawer afterwards.
  const warnings = [];
  for (const f of adapter.mappableFields || []) {
    const isMapped = valid.map.some((m) => m.target === f.key);
    if (!f.required && !isMapped) continue;
    const empty = mappedAll.filter((m) => !m[f.key]).length;
    if (!empty) continue;
    const name = f.label.toLowerCase();
    if (leads.length === 1) {
      warnings.push(f.required
        ? `${f.label} is required by ${adapter.label} but is empty for this lead.`
        : `${f.label} is empty for this lead and will not be sent.`);
    } else if (f.required) {
      warnings.push(`${empty} of the ${leads.length} leads checked have no ${name}, which ${adapter.label} requires - those will be skipped.`);
    } else {
      warnings.push(`${empty} of the ${leads.length} leads checked have no ${name}, so it will not be sent for them.`);
    }
  }

  // How many of the sampled leads the CRM would refuse outright, as a number
  // rather than only as prose in `warnings`. The dialog needs to tell "some of
  // these will be skipped" apart from "this push will send nothing at all",
  // and it cannot do that by reading English.
  const blocked = mappedAll.filter((m) => !required.every((k) => m[k])).length;

  return Response.json({
    mapped: mappedAll[at],
    warnings,
    checked: leads.length,
    blocked,
    sample: { leadId: leads[at].id, name: leads[at].name },
  });
}
