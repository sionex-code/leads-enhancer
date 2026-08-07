// Public, indexable directory pages: "Lahore Plumber Leads" and friends.
//
// What is safe to publish, and what isn't:
//
//   • The rows come from the shared WAREHOUSE (city + service), never from a
//     user's project. A project is that tenant's private working set; putting
//     one on a public URL would leak one customer's research to everybody.
//   • Only the *aggregate* of a search is recorded here — city, service,
//     country, row count. No user id, no free-typed query text, no timestamps
//     tied to a person. A typed query can contain anything and belongs to the
//     person who typed it.
//   • Contact fields are masked before they ever leave the server (see
//     maskEmail/maskPhone/maskWebsite). Blurring in CSS would still ship the
//     real address and phone to anyone who opens devtools.
"use strict";

const { pool } = require("./pg.cjs");

const q = (text, params = []) => pool().query(text, params);

// A directory page is only worth publishing, and only worth a crawler's time,
// if there is a real list behind it. Thin city x service combos are excluded.
//
// Was 500, which published 1,394 of the 7,915 seeded combos and left the
// landing page looking static. At 100 it publishes 5,408, which is still a
// substantial list per page rather than a stub.
const MIN_PUBLIC_LEADS = 100;

let _ready = null;
function ensureTable() {
  if (_ready) return _ready;
  _ready = (async () => {
    await q(`
      CREATE TABLE IF NOT EXISTS public_searches (
        slug          text PRIMARY KEY,
        city_id       integer,
        city_name     text NOT NULL DEFAULT '',
        country_code  text NOT NULL DEFAULT '',
        country_name  text NOT NULL DEFAULT '',
        service       text NOT NULL DEFAULT '',
        lead_count    integer NOT NULL DEFAULT 0,
        searches      integer NOT NULL DEFAULT 1,
        first_seen    timestamptz NOT NULL DEFAULT now(),
        last_seen     timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Added after the table shipped, so ALTER rather than a new CREATE.
    await q(`ALTER TABLE public_searches ADD COLUMN IF NOT EXISTS searcher_label text`);
    await q(`CREATE INDEX IF NOT EXISTS public_searches_last_seen_idx
             ON public_searches (last_seen DESC)`);
  })().catch((err) => {
    _ready = null; // let a later call retry rather than poisoning the module
    throw err;
  });
  return _ready;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

// City names repeat across countries (Lahore PK vs Lahore US), so the country
// code is part of the identity, not decoration.
function buildSlug({ service, cityName, countryCode }) {
  return slugify(`${service} leads in ${cityName} ${countryCode}`);
}

const titleCase = (s) =>
  String(s || "").trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "Lahore Plumber Leads" — the phrasing users actually search for.
function displayTitle(row) {
  const city = titleCase(row.city_name);
  const service = titleCase(row.service);
  return `${city} ${service} Leads`.replace(/\s+/g, " ").trim();
}

// "Muhammad Yaser" -> "Muhammad Y."  |  falls back to a masked mailbox.
//
// These pages are public and indexed, so a full name would tie a named person
// to a commercial search anyone can read. First name + last initial reads as
// attribution without identifying somebody.
function searcherLabel(name, email) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (n) {
    const parts = n.split(" ");
    return parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
      : parts[0];
  }
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at > 0) return e.slice(0, Math.min(2, at)) + "•••";
  return "";
}

// Anonymised label for a user id, or "" when unknown. Reads name/email only to
// build the initials — neither is stored.
async function labelForUser(userId) {
  if (!userId) return "";
  try {
    const r = await q(`SELECT name, email FROM users WHERE id = $1 LIMIT 1`, [userId]);
    if (!r.rows[0]) return "";
    return searcherLabel(r.rows[0].name, r.rows[0].email);
  } catch {
    return "";
  }
}

// Record (or refresh) one warehouse-backed search. Never throws into the
// request path: a directory listing is not worth failing a customer's search.
async function record({ cityId, cityName, countryCode, countryName, service, leadCount, searcher }) {
  if (!cityName || !service) return null; // nothing addressable to publish
  try {
    await ensureTable();
    const slug = buildSlug({ service, cityName, countryCode });
    if (!slug) return null;
    await q(
      `INSERT INTO public_searches
         (slug, city_id, city_name, country_code, country_name, service, lead_count, searcher_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         lead_count = GREATEST(public_searches.lead_count, EXCLUDED.lead_count),
         searches   = public_searches.searches + 1,
         searcher_label = COALESCE(EXCLUDED.searcher_label, public_searches.searcher_label),
         last_seen  = now()`,
      [slug, cityId ?? null, cityName, String(countryCode || "").toUpperCase(),
       countryName || "", service, Math.max(0, Number(leadCount) || 0), searcher || null]
    );
    return slug;
  } catch (err) {
    console.warn("[public-searches] record failed:", err.message);
    return null;
  }
}

async function recent(limit = 12) {
  try {
    await ensureTable();
    const res = await q(
      `SELECT * FROM public_searches
        WHERE lead_count >= $2
        ORDER BY last_seen DESC
        LIMIT $1`,
      [Math.min(Math.max(1, Number(limit) || 12), 100), MIN_PUBLIC_LEADS]
    );
    return res.rows.map(decorate);
  } catch (err) {
    console.warn("[public-searches] recent failed:", err.message);
    return [];
  }
}

// How many lists are published right now. The landing page prints this on the
// "browse everything" button, so it has to come from the same predicate the
// index uses rather than a number typed into the markup.
async function count() {
  try {
    await ensureTable();
    const res = await q(
      `SELECT count(*)::int AS c FROM public_searches WHERE lead_count >= $1`,
      [MIN_PUBLIC_LEADS]
    );
    return res.rows[0]?.c ?? 0;
  } catch (err) {
    console.warn("[public-searches] count failed:", err.message);
    return 0;
  }
}

async function all(limit = 500) {
  try {
    await ensureTable();
    const res = await q(
      `SELECT * FROM public_searches
        WHERE lead_count >= $2
        ORDER BY lead_count DESC, last_seen DESC
        LIMIT $1`,
      [Math.min(Math.max(1, Number(limit) || 500), 20000), MIN_PUBLIC_LEADS]
    );
    return res.rows.map(decorate);
  } catch (err) {
    console.warn("[public-searches] all failed:", err.message);
    return [];
  }
}

async function bySlug(slug) {
  if (!slug) return null;
  try {
    await ensureTable();
    const res = await q(`SELECT * FROM public_searches WHERE slug = $1`, [String(slug)]);
    return res.rows[0] ? decorate(res.rows[0]) : null;
  } catch (err) {
    console.warn("[public-searches] bySlug failed:", err.message);
    return null;
  }
}

// Sibling lists: other services in the same city, and the same service in other
// cities. These exist for the reader, but they are also what stops 1,394
// near-identical pages looking like a doorway farm to a crawler — every page
// gains inbound links from real neighbours instead of only the index.
async function related(entry, limit = 8) {
  if (!entry) return { sameCity: [], sameService: [] };
  try {
    await ensureTable();
    const [city, service] = await Promise.all([
      q(`SELECT * FROM public_searches
          WHERE city_name = $1 AND country_code = $2 AND slug <> $3 AND lead_count >= $5
          ORDER BY lead_count DESC LIMIT $4`,
        [entry.cityName, entry.countryCode, entry.slug, limit, MIN_PUBLIC_LEADS]),
      q(`SELECT * FROM public_searches
          WHERE service = $1 AND slug <> $2 AND lead_count >= $4
          ORDER BY lead_count DESC LIMIT $3`,
        [entry.service, entry.slug, limit, MIN_PUBLIC_LEADS]),
    ]);
    return { sameCity: city.rows.map(decorate), sameService: service.rows.map(decorate) };
  } catch (err) {
    console.warn("[public-searches] related failed:", err.message);
    return { sameCity: [], sameService: [] };
  }
}

function decorate(row) {
  return {
    slug: row.slug,
    cityId: row.city_id,
    cityName: row.city_name,
    countryCode: row.country_code,
    countryName: row.country_name,
    service: row.service,
    leadCount: row.lead_count,
    searches: row.searches,
    searcher: row.searcher_label || "",
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
    title: displayTitle(row),
  };
}

// ---- masking -------------------------------------------------------------
// These run on the server and the originals are never serialised into the page.

function maskEmail(email) {
  const s = String(email || "").trim();
  const at = s.indexOf("@");
  if (at < 1) return "";
  // Hide the local part — the mailbox is the part worth paying for. The domain
  // stays readable so the row still shows the lead is contactable, and it is
  // already implied by the business's own website column.
  const domain = s.slice(at + 1);
  return `${"•".repeat(Math.max(5, Math.min(10, at)))}@${domain}`;
}

function maskPhone(phone) {
  const s = String(phone || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length < 5) return "•••• ••••";
  // Keep the dialling prefix (which is the city, already on the page) and hide
  // the subscriber number, which is the part that identifies the business.
  const keep = s.startsWith("+") ? 4 : 3;
  return s.slice(0, keep) + s.slice(keep).replace(/\d/g, "•");
}

function maskWebsite(website) {
  const s = String(website || "").trim();
  if (!s) return "";
  const host = hostOf(s);
  if (!host) return "";
  const dot = host.indexOf(".");
  if (dot < 1) return "•••••";
  // Show enough of the name to be recognisable, hide the rest.
  const keep = Math.min(4, Math.max(2, dot - 2));
  return host.slice(0, keep) + "•".repeat(Math.max(3, dot - keep)) + host.slice(dot);
}

// Bare host for a URL, shared by the masking helpers.
function hostOf(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`).hostname
      .replace(/^www\./i, "").toLowerCase();
  } catch {
    return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

// The mailbox stays hidden; the domain is shown. When we hold no enriched
// address we fall back to the business's own website domain, so the column
// reads as "reachable at this domain" rather than a wall of "members only".
// It states a domain, never a specific mailbox.
function maskEmailAtDomain(email, website) {
  if (email) return maskEmail(email);
  const host = hostOf(website);
  if (!host) return "";
  return `${"•".repeat(6)}@${host}`;
}

// Keep a street address off the page but still show the neighbourhood, which is
// what makes the listing useful to browse.
function coarseAddress(address, cityName) {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return cityName || "";
  // Drop the leading street/building line; keep the area onwards.
  const tail = parts.length > 2 ? parts.slice(1) : parts;
  return tail.join(", ").slice(0, 60);
}

module.exports = {
  MIN_PUBLIC_LEADS,
  record, recent, all, count, bySlug, related,
  buildSlug, displayTitle, slugify, searcherLabel, labelForUser,
  maskEmail, maskEmailAtDomain, maskPhone, maskWebsite, coarseAddress, hostOf,
};
