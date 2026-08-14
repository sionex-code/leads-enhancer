// Sealed storage for third-party credentials.
//
// Every other secret in this app is a global env var, which is fine when the
// secret is ours. A CRM token is not ours — it can write to a customer's system
// of record — so it is stored per-user, and it is stored encrypted. This is the
// only encrypted column in the database (crm_connections.secret_enc).
//
// AES-256-GCM: the tag makes tampering detectable, which matters because the
// plaintext is a token we are about to authenticate with. Key is
// CRM_SECRET_KEY, 32 bytes base64 (`openssl rand -base64 32`), set in
// .env.local on the VPS — the deploy does not ship .env.local (see CLAUDE.md),
// so it has to be put there by hand before this feature can be used.
//
// Nothing here throws. Callers get a result object, the same shape ahrefs.cjs
// uses, because a missing key must produce a readable error in the UI rather
// than a 500 from a route nobody can debug from the outside.
const crypto = require("node:crypto");

const ALGO = "aes-256-gcm";
const VERSION = "v1";

function keyFrom(raw) {
  const buf = Buffer.from(String(raw || "").trim(), "base64");
  return buf.length === 32 ? buf : null;
}

const primaryKey = () => keyFrom(process.env.CRM_SECRET_KEY);
// Set during a rotation, alongside the new CRM_SECRET_KEY. Blobs sealed with
// the old key keep opening (reported as `stale`) until their row is re-sealed.
const oldKey = () => keyFrom(process.env.CRM_SECRET_KEY_OLD);

function hasKey() {
  return !!primaryKey();
}

// Returns "v1.<iv>.<tag>.<ciphertext>" (base64url parts), or null when no key
// is configured. A null return must abort the write: storing a credential we
// cannot encrypt, or a row whose secret is missing, both end in a connection
// nobody can use and nobody can explain.
function seal(value) {
  const key = primaryKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

// { ok: true, value, stale } | { ok: false, error, reason }
//
// `stale: true` means it opened with CRM_SECRET_KEY_OLD — the caller should
// re-seal and save, so a rotation drains itself as connections get used rather
// than needing a migration script.
function open(blob) {
  if (!blob) return { ok: false, error: "No stored credentials for this integration.", reason: "empty" };

  const parts = String(blob).split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return { ok: false, error: "Stored credentials are in an unrecognised format.", reason: "format" };
  }
  const [iv, tag, ct] = parts.slice(1).map((p) => Buffer.from(p, "base64url"));

  for (const [key, stale] of [[primaryKey(), false], [oldKey(), true]]) {
    if (!key) continue;
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      return { ok: true, value: JSON.parse(plain), stale };
    } catch {
      // Wrong key, or a tampered blob. Try the next one; if none work the
      // distinction below tells the user which of the two it is.
    }
  }

  if (!primaryKey()) {
    return { ok: false, error: "This server has no CRM_SECRET_KEY set, so stored credentials cannot be read.", reason: "no_key" };
  }
  return {
    ok: false,
    error: "Stored credentials could not be decrypted — the encryption key has changed. Reconnect this integration.",
    reason: "bad_key",
  };
}

// Last few characters of a token, stored unencrypted in `config` so the UI can
// show "which token is this?" without ever decrypting to render a list.
function hint(secret) {
  const s = String(secret || "");
  return s.length <= 4 ? "" : `…${s.slice(-4)}`;
}

module.exports = { seal, open, hasKey, hint };
