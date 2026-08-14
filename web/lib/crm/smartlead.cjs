// Smartlead — cold email campaigns.
//
// Not a CRM: a push here means "add these businesses to a sending campaign",
// which is the shape most people scraping Maps actually want. The campaign is
// therefore part of the connection, chosen from a live list rather than typed
// as a UUID.
//
// Dedupe is Smartlead's own: it validates against block lists and existing
// campaign members, and tells us how many it skipped, so re-pushing a list is
// safe. https://api.smartlead.ai/reference/add-leads-to-a-campaign-by-id
const { fetchJson, describe, retryable } = require("./http.cjs");

const API = "https://server.smartlead.ai/api/v1";
const LABEL = "Smartlead";

// The key rides in the query string — Smartlead has no header form.
const url = (creds, path, extra = "") =>
  `${API}${path}?api_key=${encodeURIComponent(creds?.apiKey || "")}${extra}`;

const fail = (res) => ({
  ok: false,
  status: res.status,
  error: describe(res, LABEL),
  retryable: retryable(res),
  retryAfterMs: res.retryAfterMs,
});

module.exports = {
  id: "smartlead",
  label: "Smartlead",
  blurb: "Add leads straight into a Smartlead campaign, ready to send.",
  docsUrl: "https://helpcenter.smartlead.ai/en/articles/8981107-how-to-get-your-smartlead-api-key",

  authFields: [
    { key: "apiKey", label: "API key", type: "password", required: true,
      help: "Smartlead → Settings → Activate API → copy your API key." },
  ],
  configFields: [
    // Filled from listTargets() once the key checks out.
    { key: "campaignId", label: "Campaign", type: "remote-select", required: true,
      help: "Which campaign new leads are added to." },
  ],

  mappableFields: [
    { key: "email", label: "Email", required: true, dedupe: true },
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "company_name", label: "Company name" },
    { key: "phone_number", label: "Phone" },
    { key: "website", label: "Website" },
    { key: "location", label: "Location" },
    { key: "linkedin_profile", label: "LinkedIn URL" },
  ],
  defaultFieldMap: [
    { target: "email", source: "email", transform: "first_email" },
    { target: "company_name", source: "name", transform: "truncate255" },
    { target: "phone_number", source: "phone", transform: "none" },
    { target: "website", source: "website", transform: "none" },
    { target: "location", source: "city", transform: "none" },
    { target: "linkedin_profile", source: "linkedin", transform: "none" },
  ],

  async testConnection(creds) {
    const res = await fetchJson(url(creds, "/campaigns"));
    if (!res.ok) return fail(res);
    const campaigns = Array.isArray(res.data) ? res.data : res.data?.data || [];
    return { ok: true, account: { name: `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}` } };
  },

  // Powers the campaign dropdown in the connect dialog.
  async listTargets(creds) {
    const res = await fetchJson(url(creds, "/campaigns"));
    if (!res.ok) return fail(res);
    const campaigns = Array.isArray(res.data) ? res.data : res.data?.data || [];
    return {
      ok: true,
      targets: campaigns.map((c) => ({
        value: String(c.id),
        label: c.name || `Campaign ${c.id}`,
        hint: c.status || "",
      })),
    };
  },

  // 400 is Smartlead's documented ceiling per request; the runner chunks at 25,
  // so one call per chunk.
  batchSize: 400,
  batchSizeFor: () => 400,

  async pushBatch(creds, config, items) {
    const campaignId = config?.campaignId;
    if (!campaignId) {
      return items.map((it) => ({
        leadId: it.lead.id, ok: false, retryable: false,
        error: "No Smartlead campaign chosen for this integration — pick one in Integrations.",
      }));
    }

    const out = [];
    const sendable = [];
    for (const it of items) {
      // Smartlead keys everything on email; without one there is nothing to add.
      if (!it.mapped.email) {
        out.push({ leadId: it.lead.id, ok: true, skipped: true, reason: "no email" });
        continue;
      }
      sendable.push(it);
    }
    if (!sendable.length) return out;

    const res = await fetchJson(url(creds, `/campaigns/${encodeURIComponent(campaignId)}/leads`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_list: sendable.map((it) => it.mapped) }),
      timeoutMs: 30000,
    });

    if (!res.ok) {
      const f = fail(res);
      for (const it of sendable) out.push({ leadId: it.lead.id, ...f });
      return out;
    }

    // Smartlead answers with counts, not per-lead results, so we cannot say
    // which of the batch it deduped — only that the batch was accepted.
    // `upload_count`/`already_added_to_campaign` naming varies by response, so
    // treat anything non-erroring as delivered.
    for (const it of sendable) out.push({ leadId: it.lead.id, ok: true, action: "delivered" });
    return out;
  },

  async pushLead(creds, config, item) {
    const [r] = await module.exports.pushBatch(creds, config, [item]);
    return r?.ok ? { ok: true, action: r.action, skipped: r.skipped, reason: r.reason } : r;
  },
};
