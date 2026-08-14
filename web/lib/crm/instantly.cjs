// Instantly — cold email campaigns (API v2).
//
// Like Smartlead, a push means "add these businesses to a campaign". v2 keys
// are Bearer tokens and are NOT the same as v1 keys; v2 access needs Growth or
// above, which is worth saying in the form rather than letting a Basic-plan key
// fail with a bare 401.
//
// Dedupe is Instantly's own: skip_if_in_campaign is sent on every lead, so
// re-pushing a list does not duplicate anyone.
// https://developer.instantly.ai/api-reference/lead/create-lead
const { fetchJson, describe, retryable } = require("./http.cjs");

const API = "https://api.instantly.ai/api/v2";
const LABEL = "Instantly";

const auth = (creds) => ({
  Authorization: `Bearer ${creds?.apiKey || ""}`,
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
  id: "instantly",
  label: "Instantly",
  blurb: "Add leads straight into an Instantly campaign, deduped against everyone already in it.",
  docsUrl: "https://developer.instantly.ai/api/v2/apikey",

  authFields: [
    { key: "apiKey", label: "API key (V2)", type: "password", required: true,
      help: "Instantly → Settings → Integrations → API keys → create a V2 key. A V1 key will not work here, and V2 needs the Growth plan or above." },
  ],
  configFields: [
    { key: "campaignId", label: "Campaign", type: "remote-select", required: true,
      help: "Which campaign new leads are added to." },
    { key: "verifyOnImport", label: "Verify emails on import", type: "select", default: "no",
      options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes (uses Instantly credits)" }] },
  ],

  mappableFields: [
    { key: "email", label: "Email", required: true, dedupe: true },
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "company_name", label: "Company name" },
    { key: "job_title", label: "Job title" },
    { key: "phone", label: "Phone" },
    { key: "website", label: "Website" },
    { key: "personalization", label: "Personalization line" },
  ],
  defaultFieldMap: [
    { target: "email", source: "email", transform: "first_email" },
    { target: "company_name", source: "name", transform: "truncate255" },
    { target: "phone", source: "phone", transform: "none" },
    { target: "website", source: "website", transform: "none" },
  ],

  async testConnection(creds) {
    const res = await fetchJson(`${API}/campaigns?limit=1`, { headers: auth(creds) });
    if (!res.ok) return fail(res);
    return { ok: true, account: { name: "Instantly workspace" } };
  },

  async listTargets(creds) {
    // One page is plenty for a picker; Instantly pages with starting_after.
    const res = await fetchJson(`${API}/campaigns?limit=100`, { headers: auth(creds) });
    if (!res.ok) return fail(res);
    const items = res.data?.items || [];
    return {
      ok: true,
      targets: items.map((c) => ({
        value: String(c.id),
        label: c.name || `Campaign ${c.id}`,
        hint: c.status ? String(c.status) : "",
      })),
    };
  },

  // v2 creates one lead per request.
  async pushLead(creds, config, { lead, mapped }) {
    const campaignId = config?.campaignId;
    if (!campaignId) {
      return { ok: false, retryable: false, error: "No Instantly campaign chosen for this integration — pick one in Integrations." };
    }
    // With `campaign` set, Instantly requires an email.
    if (!mapped.email) return { ok: true, skipped: true, reason: "no email" };

    const body = {
      campaign: campaignId,
      ...mapped,
      // Instantly does the deduping for us, which is what keeps a re-push from
      // adding the same business to a campaign twice.
      skip_if_in_campaign: true,
      verify_leads_on_import: config?.verifyOnImport === "yes",
    };

    const res = await fetchJson(`${API}/leads`, { method: "POST", headers: auth(creds), body: JSON.stringify(body) });
    if (!res.ok) return fail(res);

    const id = res.data?.id ? String(res.data.id) : null;
    return { ok: true, remoteId: id, action: "delivered" };
  },
};
