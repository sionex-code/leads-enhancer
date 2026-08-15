// Naming a set of leads to send.
//
// A target is { mode, ids?, list?, filters? } - the same three ways of naming a
// selection that CSV export uses, so "send what I'm looking at" and "export what
// I'm looking at" can never disagree.
//
// This lives apart from the push route because the preview needs to resolve the
// *same* selection: a preview drawn from some other lead is worse than none, as
// it warns about empty fields on a lead that is not being sent.
const db = require("../db.cjs");

// The same filter names /api/leads/export reads.
function filtersFrom(source = {}) {
  const str = (k) => String(source[k] ?? "");
  return {
    search: str("search"),
    hasEmail: str("hasEmail"),
    hasWhatsapp: str("hasWhatsapp"),
    hasWebsite: str("hasWebsite"),
    hasPhone: source.hasPhone === "yes" ? "yes" : source.hasPhone === "no" ? "no" : "",
    reviews: str("reviews"),
    rating: str("rating"),
    social: str("social"),
    enriched: str("enriched"),
    httpStatus: str("httpStatus"),
    minScore: Number(source.minScore || 0),
    project: str("project"),
    country: str("country"),
    city: str("city"),
    workflow: str("workflow"),
    emailStatus: str("emailStatus"),
    outreachStatus: str("outreachStatus"),
    watchlist: source.watchlist === "1" || source.watchlist === true,
    contactList: source.contactList === "1" || source.contactList === true,
    list: str("list"),
    source: str("source"),
  };
}

const modeOf = (body) =>
  body?.mode === "ids" || body?.mode === "list" || body?.mode === "filters" ? body.mode : "ids";

// { ok: true, leadIds } | { ok: false, error }
async function resolveLeadIds(userId, body, limit) {
  const mode = modeOf(body);
  if (mode === "ids") {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite))];
    return { ok: true, leadIds: ids.slice(0, limit) };
  }
  if (mode === "list") {
    if (!body.list) return { ok: false, error: "Pick a list to send." };
    return { ok: true, leadIds: await db.queryLeadIds(userId, { ...filtersFrom({}), list: String(body.list) }, limit) };
  }
  return { ok: true, leadIds: await db.queryLeadIds(userId, filtersFrom(body.filters || {}), limit) };
}

// The same selection as whole rows, in one query. Used by the preview, which
// needs the leads themselves rather than their ids.
//
// { ok: true, leads } | { ok: false, error }
async function resolveLeads(userId, body, limit) {
  const mode = modeOf(body);
  if (mode === "ids") {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isFinite))].slice(0, limit);
    if (!ids.length) return { ok: true, leads: [] };
    const { rows } = await db.queryLeads(userId, { ids, limit });
    return { ok: true, leads: rows || [] };
  }
  if (mode === "list") {
    if (!body.list) return { ok: false, error: "Pick a list to send." };
    const { rows } = await db.queryLeads(userId, { ...filtersFrom({}), list: String(body.list), limit });
    return { ok: true, leads: rows || [] };
  }
  const { rows } = await db.queryLeads(userId, { ...filtersFrom(body.filters || {}), limit });
  return { ok: true, leads: rows || [] };
}

module.exports = { filtersFrom, modeOf, resolveLeadIds, resolveLeads };
