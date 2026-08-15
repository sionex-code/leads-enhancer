import crm from "../../../../web/lib/crm/index.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// Check a credential and list what it can send to - without storing anything.
//
// This exists so the connect dialog can show a user their real campaigns before
// asking them to commit. /test and /targets both read credentials back out of a
// saved row, which forced the UI to create a connection before it could show
// the campaign picker: a wrong key left an orphan behind, and a connection
// could be saved with no campaign at all and only fail on the first push.
//
// The outbound host is the adapter's own, never anything the caller supplies -
// so there is no SSRF surface here. The webhook adapter is the one exception,
// and it brings its own checkUrl() guard, the same one the create route uses.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map(); // userId -> number[] of timestamps

// A probe is an oracle: it tells the caller whether a Smartlead or Instantly key
// is valid, using our IP rather than theirs. Cheap for a person connecting an
// account, capped so it cannot be used to test a stolen key list.
function allowed(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  // Nothing else prunes this map, so drop anyone who has gone quiet.
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  return true;
}

export async function POST(request) {
  const { userId, response } = await requireUser();
  if (response) return response;

  if (!allowed(userId)) {
    return Response.json(
      { ok: false, error: "Too many connection checks in a row - wait a minute and try again." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const adapter = crm.get(body.provider);
  if (!adapter) return Response.json({ error: "Unknown integration type." }, { status: 400 });

  const credentials = body.credentials || {};
  for (const field of adapter.authFields || []) {
    if (field.required && !String(credentials[field.key] || "").trim()) {
      // Not an error state to render in red - the user simply hasn't finished
      // typing. The dialog only probes once the field looks complete anyway.
      return Response.json({ ok: false, incomplete: true, error: `${field.label} is required.` });
    }
  }
  if (adapter.checkUrl && credentials.url) {
    const checked = adapter.checkUrl(credentials.url);
    if (!checked.ok) return Response.json({ ok: false, error: checked.error });
  }

  const config = body.config || {};

  // 200 either way, like /test and /targets: a rejected key is an answer, not a
  // server fault, and the dialog renders the sentence inline.
  let result;
  try {
    result = await adapter.testConnection(credentials, config);
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message || err) });
  }
  if (!result?.ok) return Response.json({ ok: false, error: result?.error || "The credentials were rejected." });

  // The key works - now fill the picker in the same round trip, so the user
  // sees their campaigns the moment the key checks out.
  let targets = null;
  let targetsError = null;
  if (adapter.listTargets) {
    try {
      const listed = await adapter.listTargets(credentials, config);
      if (listed?.ok) targets = listed.targets || [];
      else targetsError = listed?.error || "Could not load the list from that account.";
    } catch (err) {
      targetsError = String(err?.message || err);
    }
  }

  return Response.json({ ok: true, account: result.account || null, targets, targetsError });
}
