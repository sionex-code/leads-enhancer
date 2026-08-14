import { randomBytes } from "node:crypto";
import store from "../../../../web/lib/crm/store.cjs";
import crm from "../../../../web/lib/crm/index.cjs";
import mapping from "../../../../web/lib/crm/mapping.cjs";
import cryptoLib from "../../../../web/lib/crypto.cjs";
import { requireUser } from "../../../../web/lib/session.js";
import { DEV_AUTH_ENABLED } from "../../../../web/lib/dev-auth.js";

export const dynamic = "force-dynamic";

export async function GET() {
  // Local dev runs without a database, so serve an empty shelf rather than
  // 500ing the whole page (same branch convention as /api/leads).
  if (DEV_AUTH_ENABLED) return Response.json({ connections: [], configured: true });

  const { userId, response } = await requireUser();
  if (response) return response;
  const connections = await store.listConnections(userId);
  // `configured` tells the UI whether this server can hold credentials at all,
  // so a missing key shows as a banner instead of a failure on first save.
  return Response.json({ connections, configured: cryptoLib.hasKey() });
}

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const adapter = crm.get(body.provider);
  if (!adapter) return Response.json({ error: "Unknown integration type." }, { status: 400 });

  const label = String(body.label || adapter.label).trim().slice(0, 80);
  if (!label) return Response.json({ error: "Give this integration a name." }, { status: 400 });

  const credentials = body.credentials || {};
  for (const field of adapter.authFields || []) {
    if (field.required && !String(credentials[field.key] || "").trim()) {
      return Response.json({ error: `${field.label} is required.` }, { status: 400 });
    }
  }
  // Reject a bad endpoint before it is stored, not on first push.
  if (adapter.checkUrl && credentials.url) {
    const checked = adapter.checkUrl(credentials.url);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  }
  // A webhook with no secret is signed with one we generate, so every request
  // is verifiable even when the user didn't think to ask for it.
  if (adapter.id === "webhook" && !credentials.secret) {
    credentials.secret = randomBytes(24).toString("base64url");
  }

  const fieldMap = body.fieldMap?.length ? body.fieldMap : adapter.defaultFieldMap;
  const valid = mapping.validateFieldMap(fieldMap, adapter);
  if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });

  const config = { ...(body.config || {}) };
  for (const field of adapter.configFields || []) {
    if (config[field.key] == null && field.default != null) config[field.key] = field.default;
  }
  // Shown in the UI so a user can tell two tokens apart without us ever
  // decrypting one to render a list.
  const secretish = credentials.token || credentials.secret;
  if (secretish) config.tokenHint = cryptoLib.hint(secretish);

  let created;
  try {
    created = await store.createConnection(userId, {
      provider: adapter.id, label, credentials, config, fieldMap: valid.map,
    });
  } catch (err) {
    // The (user_id, lower(label)) unique index — a name collision, not a fault.
    if (String(err?.code) === "23505") {
      return Response.json({ error: `You already have an integration called "${label}".` }, { status: 409 });
    }
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
  if (!created.ok) {
    return Response.json(
      { error: "This server is not set up to store integration credentials yet (CRM_SECRET_KEY is missing).", code: "crm_not_configured" },
      { status: 503 }
    );
  }
  return Response.json({ connection: created.connection }, { status: 201 });
}
