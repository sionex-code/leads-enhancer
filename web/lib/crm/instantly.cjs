// Instantly - cold email campaigns (API v2).
//
// A push means "add these businesses to a campaign *or* to a lead list". v2 keys
// are Bearer tokens and are NOT the same as v1 keys; v2 access needs Growth or
// above, which is worth saying in the form rather than letting a Basic-plan key
// fail with a bare 401.
//
// Campaign or list, never both: /leads/add refuses a request carrying
// campaign_id and list_id together with
// "Cannot add leads to both a campaign and a list in the same request."
// That refusal is the whole reason the destination is one picker rather than
// two checkboxes. It matters because the two land in different places in
// Instantly's own UI: campaign leads are only visible inside that campaign,
// while list leads are what the sidebar's Leads section shows. Pushing to a
// campaign and then hunting for the leads under Leads finds nothing, which
// reads exactly like a push that silently failed.
//
// Dedupe is Instantly's own: skip_if_in_campaign / skip_if_in_list is sent on
// every lead, so re-pushing a list does not duplicate anyone.
// https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list
const crypto = require("node:crypto");
const { fetchJson, describe, retryable } = require("./http.cjs");

const API = "https://api.instantly.ai/api/v2";
const LABEL = "Instantly";

// Where a push is aimed. Stored in the `campaignId` config key as
// "campaign:<id>" or "list:<id>"; the key keeps its old name so connections
// made before lists existed keep working, and their bare id still means a
// campaign.
// `value` comes back canonical - always prefixed - even when what was stored
// was a bare id, so it can be matched against listTargets() without every
// caller having to know the old shape.
function destinationOf(config) {
  const raw = String(config?.campaignId || "").trim();
  if (!raw) return null;
  const m = /^(campaign|list):(.+)$/.exec(raw);
  return m
    ? { kind: m[1], id: m[2], value: raw }
    : { kind: "campaign", id: raw, value: `campaign:${raw}` };
}

// Instantly's campaign status codes. Only the ones worth a word are named: the
// negatives are all trouble of some kind (suspended workspace, unhealthy
// sending accounts, bounce protection), and saying which is less useful than
// saying "look at this one".
const CAMPAIGN_STATUS = { 0: "draft", 1: "active", 2: "paused", 3: "completed" };
const statusHint = (s) => CAMPAIGN_STATUS[s] || (Number(s) < 0 ? "needs attention" : "");

// Every plan caps how many leads the workspace may upload, and /leads/add is
// all-or-nothing about it: a batch larger than what is left is refused whole,
// with a 403, rather than filled up to the limit. A 600-lead push therefore
// loses ~330 perfectly good leads to one refusal while a later, smaller batch
// sails through - which reads like a permissions fault and is not one.
//
// So: remember the `remaining_in_plan` every success reports, pre-slice the
// next batch to fit it, and halve-and-retry on a 403 to rediscover the ceiling
// when we have not seen one yet (a fresh process, or another tool spending the
// same allowance behind our back).
// Deliberately short-lived. The number is only trustworthy for as long as
// nothing else spends the allowance, and it must go stale on its own: caching
// "0" forever would mean a workspace that upgrades its plan, or simply waits
// for the allowance to reset, can never push again until the process restarts.
const REMAINING_TTL_MS = 60_000;
const remainingByKey = new Map();
const keyOf = (creds) => crypto.createHash("sha256").update(String(creds?.apiKey || "")).digest("hex").slice(0, 16);

function rememberRemaining(key, value) {
  remainingByKey.set(key, { value: Math.max(0, value), at: Date.now() });
}

function knownRemaining(key) {
  const hit = remainingByKey.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > REMAINING_TTL_MS) {
    remainingByKey.delete(key);
    return null;
  }
  return hit.value;
}

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

// The one 403 that really is about permissions. Everything else Instantly
// refuses with a 403 is the plan allowance, which is a size problem, not an
// access problem, and must not be reported as "check the token".
const deniedCampaign = (res) =>
  /no access to this campaign/i.test(String(res?.data?.message || res?.text || ""));

const planExhausted = (it) => ({
  leadId: it.lead.id,
  ok: false,
  status: 403,
  // Retryable would just burn the remaining requests: the allowance does not
  // come back within a push.
  retryable: false,
  // Not an auth failure. Without this the runner's 401/403 counter would trip
  // and flag the connection as needing to be reconnected, sending the user to
  // re-enter a key that was never the problem.
  quota: true,
  error: `${LABEL}'s plan allowance is used up - no more leads can be uploaded until the workspace plan is upgraded.`,
});

// Send one group, splitting it to fit whatever the plan has left.
async function send(creds, config, dest, group) {
  if (!group.length) return [];
  const key = keyOf(creds);

  // A ceiling we already know about: send exactly what fits, then deal with
  // the remainder separately (which will be short-circuited once it is spent).
  const known = knownRemaining(key);
  if (Number.isInteger(known) && known < group.length) {
    if (known <= 0) return group.map(planExhausted);
    return [
      ...(await send(creds, config, dest, group.slice(0, known))),
      ...(await send(creds, config, dest, group.slice(known))),
    ];
  }

  const res = await fetchJson(`${API}/leads/add`, {
    method: "POST",
    headers: auth(creds),
    body: JSON.stringify({
      // One or the other - sending both is a 400. Instantly does the deduping
      // for us either way, which is what keeps a re-push from adding the same
      // business twice.
      ...(dest.kind === "list"
        ? { list_id: dest.id, skip_if_in_list: true }
        : { campaign_id: dest.id, skip_if_in_campaign: true }),
      leads: group.map((it) => it.mapped),
      verify_leads_on_import: config?.verifyOnImport === "yes",
    }),
    timeoutMs: 60000,
  });

  if (!res.ok) {
    if (res.status === 403 && !deniedCampaign(res)) {
      // Over the allowance. Halve until it fits; a single lead still refused
      // means there is genuinely nothing left.
      if (group.length > 1) {
        const mid = Math.ceil(group.length / 2);
        return [
          ...(await send(creds, config, dest, group.slice(0, mid))),
          ...(await send(creds, config, dest, group.slice(mid))),
        ];
      }
      rememberRemaining(key, 0);
      return group.map(planExhausted);
    }
    const f = fail(res);
    return group.map((it) => ({ leadId: it.lead.id, ...f }));
  }

  // Instantly reports what the upload left behind. Trusting it beats guessing,
  // and it is what lets the next batch be sized instead of refused.
  const left = Number(res.data?.remaining_in_plan);
  if (Number.isFinite(left)) rememberRemaining(key, left);

  // `created_leads[].index` indexes into the array we just sent, so every
  // lead Instantly actually created can be paired back exactly - no guessing
  // from order, which is what made the Smartlead path lossy.
  const created = new Map();
  for (const c of res.data?.created_leads || []) {
    if (Number.isInteger(c?.index) && group[c.index]) created.set(c.index, c);
    else if (c?.email) {
      const i = group.findIndex((it, n) => !created.has(n) && it.mapped.email === c.email);
      if (i >= 0) created.set(i, c);
    }
  }

  return group.map((it, i) => {
    const c = created.get(i);
    if (c) return { leadId: it.lead.id, ok: true, action: "delivered", remoteId: c.id ? String(c.id) : null };
    // Not created, but the batch was accepted - Instantly's own dedupe turned
    // it away, which means the lead is already there. Recorded as ok so the
    // ledger keeps saying "this one landed"; the runner still tallies it as
    // skipped for the job summary. A lead rejected for an unparseable email
    // lands here too - Instantly doesn't say which is which.
    return { leadId: it.lead.id, ok: true, action: "duplicate", counted: "skipped" };
  });
}

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
    // Still keyed `campaignId` so existing connections keep working - see
    // destinationOf(). The label is what the user reads, and it is no longer
    // only campaigns.
    { key: "campaignId", label: "Destination", type: "remote-select", required: true,
      help: "A campaign starts sending to these leads. A lead list just stores them, and is what Instantly's own Leads screen shows." },
    // Prominent, not behind "Advanced": Instantly only verifies at import, so a
    // push made with this off leaves leads that cannot be verified from its UI
    // afterwards. The cost of asking is one extra line; the cost of not asking
    // is a re-push, or a campaign sent to addresses nobody checked.
    //
    // `pushOverride` also puts it on the Send-to-CRM dialog: whether a batch is
    // worth spending verification credits on is a per-push decision (a scraped
    // list yes, a hand-checked one no), not a property of the connection.
    { key: "verifyOnImport", label: "Verify emails on import", type: "select", default: "no",
      prominent: true, pushOverride: true,
      options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes (uses Instantly credits)" }],
      help: "Instantly can only verify at import. Turn this on now, or re-push the list later to verify - there is no way to verify these leads from Instantly's own screens afterwards." },
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

  // Campaigns and lead lists in one picker, because Instantly makes you choose
  // one. One page of each is plenty; Instantly pages with starting_after.
  async listTargets(creds) {
    const [campaigns, lists] = await Promise.all([
      fetchJson(`${API}/campaigns?limit=100`, { headers: auth(creds) }),
      fetchJson(`${API}/lead-lists?limit=100`, { headers: auth(creds) }),
    ]);
    // Campaigns are the load-bearing half: if that call fails the key or the
    // plan is the problem, and there is nothing to choose from.
    if (!campaigns.ok) return fail(campaigns);

    const targets = (campaigns.data?.items || []).map((c) => ({
      value: `campaign:${c.id}`,
      label: c.name || `Campaign ${c.id}`,
      hint: statusHint(c.status),
      group: "Campaigns",
    }));

    // Lists are the nice half. A workspace with none, or a key scoped without
    // them, must still be able to pick a campaign rather than see an error.
    if (lists.ok) {
      for (const l of lists.data?.items || []) {
        targets.push({
          value: `list:${l.id}`,
          label: l.name || `List ${l.id}`,
          hint: "list",
          group: "Lead lists",
        });
      }
    }
    return { ok: true, targets };
  },

  destinationOf,

  // Where to actually look for these leads once they land. Instantly hides
  // campaign leads inside the campaign, so "check your Leads page" is wrong
  // half the time - which is the confusion this whole path exists to end.
  describeDestination({ kind, label }) {
    const name = label ? `"${label}"` : "the one you chose";
    return kind === "list"
      ? { path: `Leads → ${name}` }
      : {
          path: `Campaigns → ${name} → Leads`,
          note: "Leads added to a campaign do not appear under Instantly's own Leads section - that lists only lead lists. Open the campaign itself to see them.",
        };
  },

  // /leads/add takes 1000 at a time. The single-lead POST /leads works too, but
  // a 2000-lead push through it is 2000 round trips.
  batchSize: 1000,
  batchSizeFor: () => 1000,

  async pushBatch(creds, config, items) {
    const dest = destinationOf(config);
    if (!dest) {
      return items.map((it) => ({
        leadId: it.lead.id, ok: false, retryable: false,
        error: "No Instantly campaign or lead list chosen for this integration - pick one in Integrations.",
      }));
    }

    const out = [];
    const sendable = [];
    for (const it of items) {
      // Instantly keys a lead on its email whichever destination it goes to.
      if (!it.mapped.email) out.push({ leadId: it.lead.id, ok: true, skipped: true, reason: "no email" });
      else sendable.push(it);
    }
    if (!sendable.length) return out;

    out.push(...(await send(creds, config, dest, sendable)));
    return out;
  },

  async pushLead(creds, config, item) {
    const [r] = await module.exports.pushBatch(creds, config, [item]);
    return r;
  },
};
