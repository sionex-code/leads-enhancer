// Provider registry. Same shape as llm.cjs's PROVIDERS map: adding a CRM means
// writing one file and adding one line here — nothing else in the app knows the
// difference between HubSpot and a webhook.
const webhook = require("./webhook.cjs");
const hubspot = require("./hubspot.cjs");
const pipedrive = require("./pipedrive.cjs");

const PROVIDERS = {
  [webhook.id]: webhook,
  [hubspot.id]: hubspot,
  [pipedrive.id]: pipedrive,
};

const get = (id) => PROVIDERS[String(id || "").toLowerCase()] || null;

// What the connect UI needs to render a provider's form. Deliberately excludes
// the runtime functions — this is serialized to the browser.
const describeProvider = (p) => ({
  id: p.id,
  label: p.label,
  blurb: p.blurb,
  docsUrl: p.docsUrl || "",
  authFields: p.authFields || [],
  configFields: p.configFields || [],
  mappableFields: p.mappableFields || [],
  defaultFieldMap: p.defaultFieldMap || [],
});

const list = () => Object.values(PROVIDERS).map(describeProvider);

module.exports = { PROVIDERS, get, list, describeProvider };
