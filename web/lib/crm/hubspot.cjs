// HubSpot, via a private-app token.
//
// Private apps rather than OAuth on purpose: the user pastes a token from their
// own portal and it works immediately, with no app registration, redirect URI,
// or marketplace review on our side.
//
// The batch upsert endpoint is what makes this adapter cheap. `idProperty:
// "email"` means HubSpot itself matches on email and decides create-vs-update,
// so we get correct dedupe without reading their database first, 100 leads per
// request.
const { fetchJson, describe, retryable } = require("./http.cjs");

const API = "https://api.hubapi.com";
const LABEL = "HubSpot";

const auth = (creds) => ({
  Authorization: `Bearer ${creds?.token || ""}`,
  "Content-Type": "application/json",
});

const fail = (res) => ({
  ok: false,
  status: res.status,
  error: describe(res, LABEL),
  retryable: retryable(res),
  retryAfterMs: res.retryAfterMs,
});

module.exports = {
  id: "hubspot",
  label: "HubSpot",
  blurb: "Create and update HubSpot contacts, matched on email so re-pushing never duplicates.",
  // The old /docs/api/private-apps path only redirects here now; link the
  // destination so the click doesn't take an extra hop.
  docsUrl: "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview",

  authFields: [
    { key: "token", label: "Private app token", type: "password", required: true, placeholder: "pat-na1-…",
      help: "HubSpot → Settings → Integrations → Private apps (listed under Legacy apps in newer accounts) → create an app with the crm.objects.contacts.write scope, then copy its access token from the Auth tab. You need to be a super admin." },
  ],
  configFields: [
    { key: "noEmail", label: "Leads with no email", type: "select", default: "skip",
      options: [
        { value: "skip", label: "Skip them (recommended)" },
        { value: "create", label: "Create anyway" },
      ],
      help: "HubSpot matches contacts on email. Without one it cannot tell a re-push from a new contact." },
  ],

  mappableFields: [
    { key: "email", label: "Email", required: true, dedupe: true },
    { key: "company", label: "Company name" },
    { key: "firstname", label: "First name" },
    { key: "lastname", label: "Last name" },
    { key: "phone", label: "Phone" },
    { key: "website", label: "Website" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "country", label: "Country" },
    { key: "hs_lead_status", label: "Lead status" },
  ],
  defaultFieldMap: [
    { target: "email", source: "email", transform: "first_email" },
    { target: "company", source: "name", transform: "truncate255" },
    { target: "phone", source: "phone", transform: "none" },
    { target: "website", source: "website", transform: "none" },
    { target: "address", source: "address", transform: "truncate255" },
    { target: "city", source: "city", transform: "none" },
    { target: "country", source: "country", transform: "none" },
  ],

  async testConnection(creds) {
    const res = await fetchJson(`${API}/crm/v3/objects/contacts?limit=1`, { headers: auth(creds) });
    if (!res.ok) {
      // 403 here is specifically a scope problem, and saying so saves the user
      // from re-copying a token that was fine all along.
      if (res.status === 403) {
        return { ok: false, status: 403, error: "HubSpot accepted the token but it is missing the crm.objects.contacts scope. Add it in the private app's settings." };
      }
      return fail(res);
    }
    // Portal id turns stored contact ids into links the user can click.
    const acct = await fetchJson(`${API}/account-info/v3/details`, { headers: auth(creds) });
    const portalId = acct.ok ? acct.data?.portalId : null;
    return {
      ok: true,
      account: { name: acct.data?.uiDomain || "HubSpot portal", id: portalId },
      config: portalId ? { portalId } : {},
    };
  },

  batchSize: 100,
  batchSizeFor: () => 100,

  async pushBatch(creds, config, items) {
    const out = [];
    const inputs = [];
    const inputLeadIds = [];

    for (const it of items) {
      const email = it.mapped.email;
      if (!email) {
        if (config?.noEmail === "create") {
          // No email means no upsert key, so this one goes the single-object
          // route where we can remember the id ourselves.
          out.push(await createOrPatch(creds, config, it));
          continue;
        }
        out.push({ leadId: it.lead.id, ok: true, skipped: true, action: "skipped", reason: "no email" });
        continue;
      }
      const { email: _drop, ...properties } = it.mapped;
      inputs.push({ idProperty: "email", id: email, properties: { email, ...properties } });
      inputLeadIds.push(it.lead.id);
    }

    if (inputs.length) {
      const res = await fetchJson(`${API}/crm/v3/objects/contacts/batch/upsert`, {
        method: "POST", headers: auth(creds), body: JSON.stringify({ inputs }), timeoutMs: 30000,
      });
      if (!res.ok) {
        const f = fail(res);
        for (const leadId of inputLeadIds) out.push({ leadId, ...f });
      } else {
        // Results come back in request order.
        const results = res.data?.results || [];
        inputLeadIds.forEach((leadId, i) => {
          const r = results[i];
          out.push({
            leadId,
            ok: true,
            remoteId: r?.id ? String(r.id) : null,
            remoteUrl: contactUrl(config, r?.id),
            action: r?.new === false ? "updated" : "created",
          });
        });
      }
    }
    return out;
  },

  async pushLead(creds, config, item) {
    const results = await module.exports.pushBatch(creds, config, [item]);
    const r = results[0];
    if (!r) return { ok: false, error: "HubSpot returned no result for this lead.", retryable: false };
    return r.ok
      ? { ok: true, remoteId: r.remoteId, remoteUrl: r.remoteUrl, action: r.action, skipped: r.skipped, reason: r.reason }
      : r;
  },
};

function contactUrl(config, id) {
  if (!id) return null;
  return config?.portalId ? `https://app.hubspot.com/contacts/${config.portalId}/contact/${id}` : null;
}

// The no-email path. First push creates and we store the id; every push after
// that patches that id, which is what stops "create anyway" from producing a
// new contact on every run.
async function createOrPatch(creds, config, it) {
  const prevId = it.prev?.remote_id;
  const url = prevId
    ? `${API}/crm/v3/objects/contacts/${prevId}`
    : `${API}/crm/v3/objects/contacts`;
  const res = await fetchJson(url, {
    method: prevId ? "PATCH" : "POST",
    headers: auth(creds),
    body: JSON.stringify({ properties: it.mapped }),
  });
  if (!res.ok) return { leadId: it.lead.id, ...fail(res) };
  const id = res.data?.id ? String(res.data.id) : prevId || null;
  return {
    leadId: it.lead.id,
    ok: true,
    remoteId: id,
    remoteUrl: contactUrl(config, id),
    action: prevId ? "updated" : "created",
  };
}
