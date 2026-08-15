// Pipedrive, via a personal API token.
//
// Pipedrive has no upsert, so each lead is up to three calls: organization,
// then person, then optionally a Lead. Dedupe is ours to do — we remember the
// ids we created in crm_lead_sync and PUT them on the next push, falling back
// to an exact search when we have no memory of this lead.
//
// A scraped business becomes a Lead rather than a Deal by default: Deals land
// in a pipeline and skew everyone's forecast, which is not what unqualified
// scrape output should do to someone's CRM.
const { fetchJson, describe, retryable } = require("./http.cjs");

const API = "https://api.pipedrive.com";
const LABEL = "Pipedrive";

const auth = (creds) => ({
  "x-api-token": creds?.token || "",
  "Content-Type": "application/json",
});

const base = (config) => config?.apiBase || API;

const fail = (res) => ({
  ok: false,
  status: res.status,
  error: describe(res, LABEL),
  retryable: retryable(res),
  retryAfterMs: res.retryAfterMs,
});

async function call(creds, config, path, { method = "GET", body } = {}) {
  return fetchJson(`${base(config)}${path}`, {
    method,
    headers: auth(creds),
    body: body ? JSON.stringify(body) : undefined,
  });
}

module.exports = {
  id: "pipedrive",
  label: "Pipedrive",
  blurb: "Create organizations, people and leads in Pipedrive, reusing records instead of duplicating them.",
  docsUrl: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",

  authFields: [
    { key: "token", label: "API token", type: "password", required: true,
      help: "Pipedrive → your account name (top right) → Company settings → Personal preferences → API → copy your personal API token." },
  ],
  configFields: [
    { key: "createLead", label: "Also create", type: "select", default: "lead",
      options: [
        { value: "lead", label: "A Lead for each business (recommended)" },
        { value: "none", label: "Just the person and organization" },
      ],
      help: "Leads sit in Pipedrive's inbox rather than your pipeline, so scraped businesses don't skew forecasts." },
  ],

  mappableFields: [
    { key: "name", label: "Person / organization name", required: true },
    { key: "email", label: "Email", dedupe: true },
    { key: "phone", label: "Phone" },
    { key: "org_name", label: "Organization name" },
    { key: "address", label: "Address" },
  ],
  defaultFieldMap: [
    { target: "name", source: "name", transform: "truncate255" },
    { target: "org_name", source: "name", transform: "truncate255" },
    { target: "email", source: "email", transform: "first_email" },
    { target: "phone", source: "phone", transform: "none" },
    { target: "address", source: "address", transform: "truncate255" },
  ],

  async testConnection(creds) {
    const res = await fetchJson(`${API}/v1/users/me`, { headers: auth(creds) });
    if (!res.ok) return fail(res);
    const me = res.data?.data;
    // Every account has its own subdomain; without it we can't build links the
    // user can actually click, and API calls should go there too.
    const domain = me?.company_domain;
    return {
      ok: true,
      account: { name: me?.company_name || me?.name || "Pipedrive", id: me?.id },
      config: {
        companyDomain: domain || "",
        apiBase: domain ? `https://${domain}.pipedrive.com` : API,
        ownerId: me?.id || null,
      },
    };
  },

  async pushLead(creds, config, { lead, mapped, prev }) {
    const personName = mapped.name || lead.name || "Unnamed business";
    const orgName = mapped.org_name || personName;

    // 1. Organization — reuse the one we made last time, else look for an exact
    //    name match before creating another.
    let orgId = prev?.remote_org_id || null;
    if (orgId) {
      const res = await call(creds, config, `/v1/organizations/${orgId}`, {
        method: "PUT", body: { name: orgName, address: mapped.address || undefined },
      });
      // A 404 means somebody deleted it in Pipedrive; fall through and remake it.
      if (!res.ok && res.status !== 404) return fail(res);
      if (res.status === 404) orgId = null;
    }
    if (!orgId) {
      const found = await call(creds, config,
        `/v1/organizations/search?term=${encodeURIComponent(orgName)}&exact_match=true&limit=1`);
      if (!found.ok && retryable(found)) return fail(found);
      orgId = found.data?.data?.items?.[0]?.item?.id || null;

      if (!orgId) {
        const made = await call(creds, config, "/v1/organizations", {
          method: "POST",
          body: { name: orgName, address: mapped.address || undefined, owner_id: config?.ownerId || undefined },
        });
        if (!made.ok) return fail(made);
        orgId = made.data?.data?.id || null;
      }
    }

    // 2. Person — same shape: known id wins, then an exact email match, then create.
    const personBody = {
      name: personName,
      org_id: orgId || undefined,
      owner_id: config?.ownerId || undefined,
    };
    if (mapped.email) personBody.email = [{ value: mapped.email, primary: true }];
    if (mapped.phone) personBody.phone = [{ value: mapped.phone, primary: true }];

    let personId = prev?.remote_id || null;
    let action = "updated";
    if (personId) {
      const res = await call(creds, config, `/v1/persons/${personId}`, { method: "PUT", body: personBody });
      if (!res.ok && res.status !== 404) return fail(res);
      if (res.status === 404) personId = null;
    }
    if (!personId && mapped.email) {
      const found = await call(creds, config,
        `/v1/persons/search?term=${encodeURIComponent(mapped.email)}&fields=email&exact_match=true&limit=1`);
      if (!found.ok && retryable(found)) return fail(found);
      const hit = found.data?.data?.items?.[0]?.item?.id;
      if (hit) {
        personId = String(hit);
        const res = await call(creds, config, `/v1/persons/${personId}`, { method: "PUT", body: personBody });
        if (!res.ok) return fail(res);
      }
    }
    if (!personId) {
      const made = await call(creds, config, "/v1/persons", { method: "POST", body: personBody });
      if (!made.ok) return fail(made);
      personId = made.data?.data?.id ? String(made.data.data.id) : null;
      action = "created";
    }

    // 3. Lead — only on first sight. Making another one every push would bury
    //    the user's inbox in duplicates of the same business.
    if ((config?.createLead ?? "lead") === "lead" && !prev?.remote_id && personId) {
      const res = await call(creds, config, "/v1/leads", {
        method: "POST",
        body: {
          title: orgName,
          person_id: Number(personId) || undefined,
          organization_id: orgId ? Number(orgId) : undefined,
          owner_id: config?.ownerId || undefined,
        },
      });
      // A failed Lead should not fail the whole push — the person and org are
      // already in, which is the part that matters.
      if (!res.ok && retryable(res)) return fail(res);
    }

    return {
      ok: true,
      remoteId: personId ? String(personId) : null,
      remoteOrgId: orgId ? String(orgId) : null,
      remoteUrl: config?.companyDomain && personId
        ? `https://${config.companyDomain}.pipedrive.com/person/${personId}`
        : null,
      action,
    };
  },
};
