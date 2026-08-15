// Generic outbound webhook.
//
// This is the adapter that makes the feature broad rather than deep: it posts
// to any HTTPS endpoint, which means Zapier, Make, n8n, or somebody's own
// server - and through those, effectively any CRM we haven't written a
// dedicated adapter for.
//
// We can't dedupe on the receiver's behalf, so we give them what they need to
// do it themselves: a stable lead id and an idempotency key that only changes
// when the lead's mapped data changes.
const nodeCrypto = require("node:crypto");
const net = require("node:net");
const db = require("../db.cjs");
const { fetchJson, describe, retryable } = require("./http.cjs");

const LABEL = "Your endpoint";

// A user-supplied URL that we then fetch server-side is an SSRF hole: without
// this, "http://169.254.169.254/…" turns the push feature into a way to read
// this VPS's cloud metadata. HTTPS-only, and no addresses that resolve inside
// our own network.
function checkUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { return { ok: false, error: "That is not a valid URL." }; }
  if (url.protocol !== "https:") return { ok: false, error: "The URL must start with https://" };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "That address is not reachable from the internet." };
  }
  // Literal IPs are checked directly. Hostnames that *resolve* to private space
  // are not caught here - DNS can change between check and fetch anyway - but
  // the literal case is the one people actually hit.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, error: "That address is not reachable from the internet." };
  }
  return { ok: true, url: url.toString() };
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||          // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);  // carrier-grade NAT
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd");
}

// The timestamp is inside the signed string, not just a header, so a captured
// body can't be replayed later with a fresh timestamp.
function sign(secret, timestamp, body) {
  return "sha256=" + nodeCrypto.createHmac("sha256", String(secret)).update(`${timestamp}.${body}`).digest("hex");
}

function envelope(event, connectionId, leads) {
  return {
    event,
    sentAt: new Date().toISOString(),
    connectionId,
    leads,
  };
}

async function post(creds, config, payload, idempotencyKey) {
  const checked = checkUrl(creds?.url);
  if (!checked.ok) return { ok: false, error: checked.error, status: 0, retryable: false };

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "LeadsFunda/1.0 (+https://leadsfunda.com)",
    "X-LeadsFunda-Timestamp": String(timestamp),
    "X-LeadsFunda-Event": payload.event,
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  if (creds?.secret) headers[config?.headerName || "X-LeadsFunda-Signature"] = sign(creds.secret, timestamp, body);

  const res = await fetchJson(checked.url, { method: "POST", headers, body });
  if (res.ok) return { ok: true, status: res.status };
  return {
    ok: false,
    status: res.status,
    error: describe(res, LABEL),
    retryable: retryable(res),
    retryAfterMs: res.retryAfterMs,
  };
}

module.exports = {
  id: "webhook",
  label: "Webhook",
  blurb: "POST leads to any HTTPS endpoint - your own server, or Zapier, Make and n8n to reach any other CRM.",
  docsUrl: "",

  authFields: [
    { key: "url", label: "Endpoint URL", type: "url", required: true, placeholder: "https://hooks.zapier.com/…",
      help: "Must be HTTPS and reachable from the internet." },
    { key: "secret", label: "Signing secret", type: "password", required: false,
      help: "Optional. When set, each request carries an HMAC-SHA256 signature you can verify." },
  ],
  configFields: [
    { key: "batchSize", label: "Leads per request", type: "select", default: "1",
      options: [
        { value: "1", label: "One lead per request (Zapier / Make)" },
        { value: "25", label: "25 per request" },
        { value: "100", label: "100 per request" },
      ] },
    { key: "headerName", label: "Signature header", type: "text", default: "X-LeadsFunda-Signature" },
  ],

  // A webhook receiver can take anything, so every lead column is offered.
  get mappableFields() {
    return db.EXPORT_COLUMNS.map((c) => ({ key: c, label: c.replace(/_/g, " ") }));
  },
  defaultFieldMap: [
    "name", "email", "phone", "website", "domain", "address", "city", "country",
    "category", "rating", "reviews", "maps_url",
  ].map((c) => ({ target: c, source: c, transform: "none" })),

  checkUrl,
  sign,

  // Sends a real request with a clearly-marked sample, so the user sees the
  // exact shape land in their tool before they trust it with 500 leads.
  async testConnection(creds, config) {
    const sample = {
      id: 0,
      name: "LeadsFunda test business",
      email: "test@example.com",
      phone: "+10000000000",
      website: "https://example.com",
      city: "Testville",
    };
    const res = await post(creds, config, envelope("connection.test", null, [sample]), "lf_test");
    if (!res.ok) return res;
    return { ok: true, account: { name: new URL(creds.url).host } };
  },

  // batchSize is a string from the select; the runner reads it off `config`.
  batchSizeFor: (config) => Math.max(1, Number(config?.batchSize) || 1),

  async pushBatch(creds, config, items) {
    const leads = items.map((it) => ({ id: it.lead.id, ...it.mapped }));
    const key = items.length === 1 ? items[0].idempotencyKey : `lf_batch_${nodeCrypto.randomUUID()}`;
    const res = await post(creds, config, envelope("lead.push", items[0]?.connectionId ?? null, leads), key);

    // One request covers the whole batch, so its outcome is every item's outcome.
    return items.map((it) => (res.ok
      ? { leadId: it.lead.id, ok: true, action: "delivered" }
      : { leadId: it.lead.id, ok: false, error: res.error, status: res.status, retryable: res.retryable, retryAfterMs: res.retryAfterMs }));
  },

  async pushLead(creds, config, { lead, mapped, idempotencyKey, connectionId }) {
    const res = await post(creds, config, envelope("lead.push", connectionId, [{ id: lead.id, ...mapped }]), idempotencyKey);
    return res.ok ? { ok: true, action: "delivered" } : res;
  },
};
