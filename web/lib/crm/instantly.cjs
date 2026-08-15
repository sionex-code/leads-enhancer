// Instantly - cold email campaigns (API v2).
//
// Like Smartlead, a push means "add these businesses to a campaign". v2 keys
// are Bearer tokens and are NOT the same as v1 keys; v2 access needs Growth or
// above, which is worth saying in the form rather than letting a Basic-plan key
// fail with a bare 401.
//
// Dedupe is Instantly's own: skip_if_in_campaign is sent on every lead, so
// re-pushing a list does not duplicate anyone.
// https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list
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
  // The developer-reference deep links (developer.instantly.ai/api/v2/…) are a
  // client-rendered SPA and 404 when opened directly, which is what a user
  // clicking this actually does. The help-centre article is a real page.
  docsUrl: "https://help.instantly.ai/en/articles/10432807-api-v2",

  authFields: [
    { key: "apiKey", label: "API key (V2)", type: "password", required: true,
      help: "Instantly → Settings → Integrations → API keys → create a V2 key with the leads:create scope (or All). A V1 key will not work here." },
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

  // /leads/add takes 1000 at a time. The single-lead POST /leads works too, but
  // a 2000-lead push through it is 2000 round trips.
  batchSize: 1000,
  batchSizeFor: () => 1000,

  async pushBatch(creds, config, items) {
    const campaignId = config?.campaignId;
    if (!campaignId) {
      return items.map((it) => ({
        leadId: it.lead.id, ok: false, retryable: false,
        error: "No Instantly campaign chosen for this integration - pick one in Integrations.",
      }));
    }

    const out = [];
    const sendable = [];
    for (const it of items) {
      // With a campaign (rather than a list) Instantly requires an email.
      if (!it.mapped.email) out.push({ leadId: it.lead.id, ok: true, skipped: true, reason: "no email" });
      else sendable.push(it);
    }
    if (!sendable.length) return out;

    const res = await fetchJson(`${API}/leads/add`, {
      method: "POST",
      headers: auth(creds),
      body: JSON.stringify({
        campaign_id: campaignId,
        leads: sendable.map((it) => it.mapped),
        // Instantly does the deduping for us, which is what keeps a re-push
        // from adding the same business to a campaign twice.
        skip_if_in_campaign: true,
        verify_leads_on_import: config?.verifyOnImport === "yes",
      }),
      timeoutMs: 60000,
    });

    if (!res.ok) {
      const f = fail(res);
      for (const it of sendable) out.push({ leadId: it.lead.id, ...f });
      return out;
    }

    // `created_leads[].index` indexes into the array we just sent, so every
    // lead Instantly actually created can be paired back exactly - no guessing
    // from order, which is what made the Smartlead path lossy.
    const created = new Map();
    for (const c of res.data?.created_leads || []) {
      if (Number.isInteger(c?.index) && sendable[c.index]) created.set(c.index, c);
      else if (c?.email) {
        const i = sendable.findIndex((it, n) => !created.has(n) && it.mapped.email === c.email);
        if (i >= 0) created.set(i, c);
      }
    }

    sendable.forEach((it, i) => {
      const c = created.get(i);
      if (c) {
        out.push({ leadId: it.lead.id, ok: true, action: "delivered", remoteId: c.id ? String(c.id) : null });
        return;
      }
      // Not created, but the batch was accepted - Instantly's own dedupe turned
      // it away, which means the lead is already there. Recorded as ok so the
      // ledger keeps saying "this one landed"; the runner still tallies it as
      // skipped for the job summary. A lead rejected for an unparseable email
      // lands here too - Instantly doesn't say which is which, so the counts
      // below carry that detail instead.
      out.push({ leadId: it.lead.id, ok: true, action: "duplicate", counted: "skipped" });
    });

    return out;
  },

  async pushLead(creds, config, item) {
    const [r] = await module.exports.pushBatch(creds, config, [item]);
    return r;
  },
};
