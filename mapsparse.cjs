// Decode + extract Google Maps "/search?tbm=map" RPC responses into lead rows.
// These responses carry ~20 fully-detailed places each, so reading them straight
// off the network is far faster than clicking every result card in the DOM.
//
// Two wire formats are handled:
//   1. Initial page load:  )]}'\n[[ ...deeply nested array... ]]
//   2. Scroll/pagination:  one or more {"c":N,"d":"<escaped payload>"} chunks,
//      each optionally followed by a /*""*/ separator. Concatenate the d fields.

function decode(body) {
  body = String(body || "").trim();
  if (!body) return null;
  if (body.startsWith(")]}'")) {
    return JSON.parse(body.replace(/^\)\]\}'\s*/, ""));
  }
  if (body[0] === "{") {
    const pieces = body.split('/*""*/').map((s) => s.trim()).filter(Boolean);
    let payload = "";
    for (const piece of pieces) {
      try {
        const o = JSON.parse(piece);
        if (typeof o.d === "string") payload += o.d;
      } catch {}
    }
    if (!payload) return null;
    return JSON.parse(payload.replace(/^\)\]\}'\s*/, ""));
  }
  return null;
}

// Every place is an array whose [11] is the business name. They sit at varying
// depths (sponsored vs organic wrap differently), so walk the tree and collect
// any array shaped like a place instead of relying on fixed parent indices.
function findPlaceNodes(decoded) {
  const out = [];
  (function walk(n) {
    if (!Array.isArray(n)) return;
    if (typeof n[11] === "string" && n[11].length > 1 && n.length > 30) out.push(n);
    for (const x of n) walk(x);
  })(decoded);
  return out;
}

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

const OLC = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/;

function deepFind(node, pred, limit, out = []) {
  if (out.length >= limit) return out;
  if (pred(node)) out.push(node);
  if (Array.isArray(node)) for (const x of node) deepFind(x, pred, limit, out);
  return out;
}

function placeId(p) {
  return (p[227] && p[227][0] && p[227][0][4]) || ""; // ChIJ... feature id
}

// Stable key for dedup across batches: prefer the cid hex, fall back to place id.
function placeKey(p) {
  return clean(p[10]) || placeId(p) || clean(p[11]);
}

function formatHours(p) {
  const rows = p[203] && p[203][0];
  if (!Array.isArray(rows)) return "";
  return rows
    .map((row) => {
      if (!Array.isArray(row)) return "";
      const day = clean(row[0]);
      const spans = (Array.isArray(row[3]) ? row[3] : [])
        .map((s) => (Array.isArray(s) ? clean(s[0]) : ""))
        .filter(Boolean)
        .join(", ");
      return day ? `${day}: ${spans || "Closed"}` : "";
    })
    .filter(Boolean)
    .join(" | ");
}

function extractRow(p) {
  const website = p[7] && p[7][0] ? clean(p[7][0]) : "";
  const websiteText = p[7] && p[7][1] ? clean(p[7][1]) : "";
  const phoneBlk = p[178] && p[178][0];
  const phone = phoneBlk ? clean(phoneBlk[3] || phoneBlk[0]) : "";
  const address = clean(p[39]) || (Array.isArray(p[2]) ? p[2].map(clean).filter(Boolean).join(", ") : "");
  const rating = p[4] && p[4][7] != null ? clean(p[4][7]) : "";
  const reviews = p[4] && p[4][8] != null ? clean(p[4][8]) : "";
  const category = Array.isArray(p[13]) && p[13][0] ? clean(p[13][0]) : "";

  let plusCode = "";
  const plusHit = deepFind(p, (v) => typeof v === "string" && OLC.test(v), 1);
  if (plusHit.length) plusCode = (plusHit[0].match(OLC) || [""])[0];

  const photos = deepFind(
    p,
    (v) => typeof v === "string" && /(googleusercontent\.com|ggpht\.com)\//.test(v) && !/default_user|cleardot/.test(v),
    6
  );
  const imageUrls = [...new Set(photos.map((u) => u.replace(/^\/\//, "https://")))].join(" | ");

  const pid = placeId(p);
  const mapsUrl = pid
    ? `https://www.google.com/maps/place/?q=place_id:${pid}`
    : p[10]
      ? `https://maps.google.com/?cid=${BigInt("0x" + String(p[10]).split(":")[1]).toString()}`
      : "";

  return {
    name: clean(p[11]),
    category,
    rating,
    reviews,
    website,
    websiteText,
    phone,
    address,
    plusCode,
    hours: formatHours(p),
    imageUrls,
    mapsUrl,
  };
}

// Decode a raw response body and return { rows, keys } (keys parallel to rows).
function rowsFromBody(body) {
  const decoded = decode(body);
  if (!decoded) return { rows: [], keys: [] };
  const nodes = findPlaceNodes(decoded);
  const rows = [];
  const keys = [];
  for (const p of nodes) {
    const name = clean(p[11]);
    if (!name) continue;
    rows.push(extractRow(p));
    keys.push(placeKey(p));
  }
  return { rows, keys };
}

module.exports = { decode, findPlaceNodes, extractRow, rowsFromBody, placeKey };
