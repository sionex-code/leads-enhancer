import db from "../../../../../../web/lib/db.cjs";
import store from "../../../../../../web/lib/crm/store.cjs";
import crm from "../../../../../../web/lib/crm/index.cjs";
import mapping from "../../../../../../web/lib/crm/mapping.cjs";
import { requireUser } from "../../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

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

  let lead = null;
  if (body.leadId) {
    lead = await db.getLead(userId, body.leadId);
  } else {
    const { rows } = await db.queryLeads(userId, { limit: 1 });
    lead = rows?.[0] || null;
  }
  if (!lead) return Response.json({ error: "You have no leads to preview yet." }, { status: 400 });

  const fieldMap = body.fieldMap?.length ? body.fieldMap : (connection.field_map?.length ? connection.field_map : adapter.defaultFieldMap);
  const valid = mapping.validateFieldMap(fieldMap, adapter);
  if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });

  const mapped = mapping.applyFieldMap(lead, valid.map);

  // Which mapped fields came out empty for this lead — the usual reason a CRM
  // later rejects a row, and much cheaper to notice here.
  const warnings = [];
  for (const f of adapter.mappableFields || []) {
    const isMapped = valid.map.some((m) => m.target === f.key);
    if (f.required && !mapped[f.key]) {
      warnings.push(`${f.label} is required by ${adapter.label} but is empty for this lead.`);
    } else if (isMapped && !mapped[f.key]) {
      warnings.push(`${f.label} is empty for this lead and will not be sent.`);
    }
  }

  return Response.json({
    mapped,
    warnings,
    sample: { leadId: lead.id, name: lead.name },
  });
}
