// Turning a lead row into whatever shape a CRM wants.
//
// A field map is [{ target, source, transform?, constant? }]:
//   target    — a key the adapter declared in mappableFields
//   source    — a lead column (snake_case, as it comes back from Postgres),
//               or "__constant" to send a fixed value
//   transform — an optional named transform from TRANSFORMS
//
// Both ends are validated against allowlists before anything is stored, because
// the target is forwarded verbatim to a third-party API and the source names a
// property we read off a database row.
const crypto = require("node:crypto");
const db = require("../db.cjs");

const SOURCE_COLUMNS = new Set([...db.LEAD_COLUMNS, ...db.WORKFLOW_COLUMNS, "id", "dedup_key", "first_seen", "last_updated"]);

const TRANSFORMS = {
  none: (v) => v,
  lower: (v) => String(v).toLowerCase(),
  upper: (v) => String(v).toUpperCase(),
  // all_emails holds "a@x.com | b@x.com"; a CRM wants exactly one.
  first_email: (v) => String(v).split(/[|,;\s]+/).map((s) => s.trim()).filter(Boolean)[0] || "",
  digits: (v) => String(v).replace(/[^\d+]/g, ""),
  host: (v) => db.hostOf(v) || "",
  truncate255: (v) => String(v).slice(0, 255),
};

const TRANSFORM_NAMES = Object.keys(TRANSFORMS);

// { ok: true, map } | { ok: false, error }
function validateFieldMap(map, adapter) {
  if (!Array.isArray(map)) return { ok: false, error: "Field mapping must be a list." };
  const targets = new Set((adapter.mappableFields || []).map((f) => f.key));
  const seen = new Set();
  const clean = [];

  for (const entry of map) {
    const target = String(entry?.target || "").trim();
    const source = String(entry?.source || "").trim();
    if (!target) continue;
    if (!targets.has(target)) return { ok: false, error: `"${target}" is not a field ${adapter.label} accepts.` };
    if (seen.has(target)) return { ok: false, error: `"${target}" is mapped more than once.` };
    seen.add(target);

    if (source === "__constant") {
      clean.push({ target, source, constant: String(entry.constant ?? "").slice(0, 500) });
      continue;
    }
    if (!SOURCE_COLUMNS.has(source)) return { ok: false, error: `"${source}" is not a lead field.` };
    const transform = String(entry?.transform || "none");
    if (!TRANSFORMS[transform]) return { ok: false, error: `"${transform}" is not a known transform.` };
    clean.push({ target, source, transform });
  }

  for (const f of adapter.mappableFields || []) {
    if (f.required && !seen.has(f.key)) return { ok: false, error: `${adapter.label} needs "${f.label}" mapped.` };
  }
  return { ok: true, map: clean };
}

// Empty values are dropped rather than sent. Writing "" over a phone number
// somebody already has in their CRM is worse than sending nothing.
function applyFieldMap(lead, map) {
  const out = {};
  for (const m of map || []) {
    const raw = m.source === "__constant" ? m.constant : lead?.[m.source];
    if (raw == null) continue;
    const fn = TRANSFORMS[m.transform] || TRANSFORMS.none;
    let value;
    try { value = fn(raw); } catch { continue; }
    if (typeof value === "string") value = value.trim();
    if (value === "" || value == null) continue;
    out[m.target] = value;
  }
  return out;
}

// Stable across key order, so it only changes when the data does. This is what
// makes "push everything again" cheap: unchanged leads are skipped without a
// request.
function payloadHash(mapped) {
  const canonical = Object.keys(mapped || {}).sort().map((k) => `${k}=${mapped[k]}`).join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// Stable for the same content, different when the content changes — so a retry
// of the same push is recognisably the same request to the receiver, but an
// edited lead is not.
function idempotencyKey(connectionId, leadId, hash) {
  return `lf_${connectionId}_${leadId}_${String(hash).slice(0, 12)}`;
}

module.exports = {
  TRANSFORMS, TRANSFORM_NAMES, SOURCE_COLUMNS,
  validateFieldMap, applyFieldMap, payloadHash, idempotencyKey,
};
