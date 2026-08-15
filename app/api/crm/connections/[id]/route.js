import store from "../../../../../web/lib/crm/store.cjs";
import crm from "../../../../../web/lib/crm/index.cjs";
import mapping from "../../../../../web/lib/crm/mapping.cjs";
import cryptoLib from "../../../../../web/lib/crypto.cjs";
import { requireUser } from "../../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  const existing = await store.getConnection(userId, id);
  if (!existing) return Response.json({ error: "Integration not found." }, { status: 404 });
  const adapter = crm.get(existing.provider);
  if (!adapter) return Response.json({ error: "Unknown integration type." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const patch = {};

  if (body.label != null) {
    const label = String(body.label).trim().slice(0, 80);
    if (!label) return Response.json({ error: "Give this integration a name." }, { status: 400 });
    patch.label = label;
  }

  if (body.fieldMap != null) {
    const valid = mapping.validateFieldMap(body.fieldMap, adapter);
    if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });
    patch.fieldMap = valid.map;
  }

  if (body.config != null) patch.config = { ...existing.config, ...body.config };

  // Omitting `credentials` deliberately leaves the stored secret alone, so
  // editing a field map doesn't force the user to paste their token again.
  if (body.credentials != null && Object.keys(body.credentials).length) {
    const credentials = body.credentials;
    for (const field of adapter.authFields || []) {
      if (field.required && !String(credentials[field.key] || "").trim()) {
        return Response.json({ error: `${field.label} is required.` }, { status: 400 });
      }
    }
    if (adapter.checkUrl && credentials.url) {
      const checked = adapter.checkUrl(credentials.url);
      if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    }
    patch.credentials = credentials;
    const secretish = credentials.apiKey || credentials.token || credentials.secret;
    if (secretish) patch.config = { ...(patch.config || existing.config), tokenHint: cryptoLib.hint(secretish) };
    // New credentials are unproven until tested.
    patch.status = "unverified";
    patch.lastError = null;
  }

  try {
    const updated = await store.updateConnection(userId, id, patch);
    if (!updated.ok) {
      return Response.json({ error: "This server is not set up to store integration credentials yet.", code: "crm_not_configured" }, { status: 503 });
    }
    return Response.json({ connection: updated.connection });
  } catch (err) {
    if (String(err?.code) === "23505") {
      return Response.json({ error: "You already have an integration with that name." }, { status: 409 });
    }
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const { userId, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  const existing = await store.getConnection(userId, id);
  if (!existing) return Response.json({ error: "Integration not found." }, { status: 404 });

  const res = await store.deleteConnection(userId, id);
  return Response.json({ ok: res.deleted, deletedSyncRows: res.deletedSyncRows });
}
