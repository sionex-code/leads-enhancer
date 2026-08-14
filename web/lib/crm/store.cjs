// All SQL for the three CRM tables. Same conventions as db.cjs: raw
// parameterized queries through the shared pool, `userId` first on every
// function, `WHERE user_id = $1` on every statement — including the ones that
// look up by primary key, so a guessed id from another tenant reads as "not
// found" rather than leaking a row.
const { pool } = require("../pg.cjs");
const crypto = require("../crypto.cjs");

const q = (text, params = []) => pool().query(text, params);
const now = () => new Date().toISOString();

// The credential blob never leaves this module. Routes get `tokenHint` out of
// `config` instead, which is written at save time.
const PUBLIC_COLUMNS = `id, user_id, provider, label, config, field_map, status,
                        last_error, last_tested_at, last_push_at, created_at, updated_at`;

// ---- connections ------------------------------------------------------------

async function listConnections(userId) {
  const { rows } = await q(
    `SELECT ${PUBLIC_COLUMNS} FROM crm_connections WHERE user_id = $1 ORDER BY id DESC`,
    [userId]
  );
  return rows;
}

async function getConnection(userId, id) {
  const { rows } = await q(
    `SELECT ${PUBLIC_COLUMNS} FROM crm_connections WHERE id = $1 AND user_id = $2`,
    [Number(id), userId]
  );
  return rows[0] || null;
}

// Decrypt on the way out, and re-seal in place when the blob opened with the
// retired key. Rotation therefore drains itself as connections get used; no
// migration script, and no window where half the rows are unreadable.
//
// { ok: true, connection, credentials } | { ok: false, error, reason }
async function getConnectionWithCredentials(userId, id) {
  const { rows } = await q(
    `SELECT ${PUBLIC_COLUMNS}, secret_enc FROM crm_connections WHERE id = $1 AND user_id = $2`,
    [Number(id), userId]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Integration not found.", reason: "missing" };

  const opened = crypto.open(row.secret_enc);
  if (!opened.ok) return { ok: false, error: opened.error, reason: opened.reason };

  if (opened.stale) {
    const resealed = crypto.seal(opened.value);
    if (resealed) {
      await q(`UPDATE crm_connections SET secret_enc = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
        [resealed, now(), Number(id), userId]);
    }
  }

  const { secret_enc, ...connection } = row;
  return { ok: true, connection, credentials: opened.value };
}

async function createConnection(userId, { provider, label, credentials, config = {}, fieldMap = [] }) {
  const sealed = crypto.seal(credentials || {});
  if (!sealed) return { ok: false, reason: "no_key" };
  const ts = now();
  const { rows } = await q(
    `INSERT INTO crm_connections (user_id, provider, label, secret_enc, config, field_map, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'unverified',$7,$7)
     RETURNING ${PUBLIC_COLUMNS}`,
    [userId, provider, label, sealed, JSON.stringify(config), JSON.stringify(fieldMap), ts]
  );
  return { ok: true, connection: rows[0] };
}

// `credentials` omitted leaves the stored secret untouched — that is what lets
// the UI save a field-map change without making the user paste their token again.
async function updateConnection(userId, id, patch = {}) {
  const sets = [];
  const params = [Number(id), userId];
  const push = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };

  if (patch.label != null) push("label", patch.label);
  if (patch.config != null) push("config", JSON.stringify(patch.config));
  if (patch.fieldMap != null) push("field_map", JSON.stringify(patch.fieldMap));
  if (patch.status != null) push("status", patch.status);
  if (patch.lastError !== undefined) push("last_error", patch.lastError);
  if (patch.lastTestedAt != null) push("last_tested_at", patch.lastTestedAt);
  if (patch.lastPushAt != null) push("last_push_at", patch.lastPushAt);
  if (patch.credentials != null) {
    const sealed = crypto.seal(patch.credentials);
    if (!sealed) return { ok: false, reason: "no_key" };
    push("secret_enc", sealed);
  }
  if (!sets.length) return { ok: true, connection: await getConnection(userId, id) };

  params.push(now());
  const { rows } = await q(
    `UPDATE crm_connections SET ${sets.join(", ")}, updated_at = $${params.length}
      WHERE id = $1 AND user_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
    params
  );
  return { ok: true, connection: rows[0] || null };
}

async function deleteConnection(userId, id) {
  const sync = await q(`DELETE FROM crm_lead_sync WHERE connection_id = $1 AND user_id = $2`, [Number(id), userId]);
  const res = await q(`DELETE FROM crm_connections WHERE id = $1 AND user_id = $2`, [Number(id), userId]);
  return { deleted: res.rowCount > 0, deletedSyncRows: sync.rowCount };
}

// Cast in `config` without clobbering the rest of it (config holds both
// adapter settings and the token hint).
async function mergeConfig(userId, id, patch) {
  const { rows } = await q(
    `UPDATE crm_connections SET config = config || $3::jsonb, updated_at = $4
      WHERE id = $1 AND user_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
    [Number(id), userId, JSON.stringify(patch || {}), now()]
  );
  return rows[0] || null;
}

// ---- per-lead sync state ----------------------------------------------------

async function getSyncForLeads(userId, connectionId, leadIds) {
  if (!leadIds?.length) return new Map();
  const { rows } = await q(
    `SELECT * FROM crm_lead_sync WHERE user_id = $1 AND connection_id = $2 AND lead_id = ANY($3::int[])`,
    [userId, Number(connectionId), leadIds]
  );
  return new Map(rows.map((r) => [r.lead_id, r]));
}

async function getSyncForLead(userId, leadId) {
  const { rows } = await q(
    `SELECT s.*, c.label, c.provider
       FROM crm_lead_sync s JOIN crm_connections c ON c.id = s.connection_id
      WHERE s.user_id = $1 AND s.lead_id = $2 ORDER BY s.last_pushed_at DESC`,
    [userId, Number(leadId)]
  );
  return rows;
}

// One statement for a whole chunk. COALESCE on the remote ids matters: a push
// that fails after we already know the CRM's id for this lead must not erase
// it, or the next attempt creates a duplicate instead of updating.
async function upsertSync(userId, connectionId, results) {
  if (!results?.length) return 0;
  const ts = now();
  const cols = {
    lead_id: [], remote_id: [], remote_org_id: [], remote_url: [],
    status: [], action: [], payload_hash: [], error: [], attempts: [],
  };
  for (const r of results) {
    cols.lead_id.push(Number(r.leadId));
    cols.remote_id.push(r.remoteId ?? null);
    cols.remote_org_id.push(r.remoteOrgId ?? null);
    cols.remote_url.push(r.remoteUrl ?? null);
    cols.status.push(r.status);
    cols.action.push(r.action ?? null);
    cols.payload_hash.push(r.payloadHash ?? null);
    cols.error.push(r.error ?? null);
    cols.attempts.push(Number(r.attempts || 1));
  }
  const res = await q(
    `INSERT INTO crm_lead_sync
       (connection_id, user_id, lead_id, remote_id, remote_org_id, remote_url,
        status, action, payload_hash, error, attempts, first_pushed_at, last_pushed_at)
     SELECT $1, $2, t.lead_id, t.remote_id, t.remote_org_id, t.remote_url,
            t.status, t.action, t.payload_hash, t.error, t.attempts, $12, $12
       FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[],
                   $8::text[], $9::text[], $10::text[], $11::int[])
         AS t(lead_id, remote_id, remote_org_id, remote_url, status, action, payload_hash, error, attempts)
     ON CONFLICT (connection_id, lead_id) DO UPDATE SET
       remote_id     = COALESCE(EXCLUDED.remote_id, crm_lead_sync.remote_id),
       remote_org_id = COALESCE(EXCLUDED.remote_org_id, crm_lead_sync.remote_org_id),
       remote_url    = COALESCE(EXCLUDED.remote_url, crm_lead_sync.remote_url),
       status        = EXCLUDED.status,
       action        = EXCLUDED.action,
       payload_hash  = COALESCE(EXCLUDED.payload_hash, crm_lead_sync.payload_hash),
       error         = EXCLUDED.error,
       attempts      = crm_lead_sync.attempts + EXCLUDED.attempts,
       last_pushed_at = EXCLUDED.last_pushed_at`,
    [Number(connectionId), userId, cols.lead_id, cols.remote_id, cols.remote_org_id,
     cols.remote_url, cols.status, cols.action, cols.payload_hash, cols.error, cols.attempts, ts]
  );
  return res.rowCount;
}

// ---- push jobs --------------------------------------------------------------

async function createJob(userId, { connectionId, mode, source, leadIds }) {
  const { rows } = await q(
    `INSERT INTO crm_push_jobs (user_id, connection_id, status, mode, source, lead_ids, total, created_at)
     VALUES ($1,$2,'queued',$3,$4::jsonb,$5::int[],$6,$7) RETURNING *`,
    [userId, Number(connectionId), mode, JSON.stringify(source || {}), leadIds, leadIds.length, now()]
  );
  return rows[0];
}

// Atomic claim. The `status IN (...)` guard is the whole concurrency story: two
// callers (a double-submit, or boot recovery racing a live kick) cannot both
// win, and it stays correct if the app is ever run as more than one process.
async function claimJob(jobId) {
  const { rows } = await q(
    `UPDATE crm_push_jobs SET status = 'running', heartbeat_at = $2
      WHERE id = $1 AND status IN ('queued','interrupted') RETURNING *`,
    [Number(jobId), now()]
  );
  return rows[0] || null;
}

async function patchJob(jobId, patch = {}) {
  const sets = [];
  const params = [Number(jobId)];
  const push = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };
  for (const [key, col] of Object.entries({
    status: "status", done: "done", succeeded: "succeeded", failed: "failed",
    skipped: "skipped", cursor: "cursor", lastError: "last_error", finishedAt: "finished_at",
  })) {
    if (patch[key] !== undefined) push(col, patch[key]);
  }
  push("heartbeat_at", now());
  const { rows } = await q(
    `UPDATE crm_push_jobs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

async function getJob(userId, jobId) {
  const { rows } = await q(
    `SELECT j.*, c.label AS connection_label, c.provider AS connection_provider
       FROM crm_push_jobs j LEFT JOIN crm_connections c ON c.id = j.connection_id
      WHERE j.id = $1 AND j.user_id = $2`,
    [Number(jobId), userId]
  );
  return rows[0] || null;
}

// Runner-side read: no userId, because the runner already holds a job it
// claimed. Never call this from a route.
async function getJobInternal(jobId) {
  const { rows } = await q(`SELECT * FROM crm_push_jobs WHERE id = $1`, [Number(jobId)]);
  return rows[0] || null;
}

async function listJobs(userId, { limit = 20, connectionId = null } = {}) {
  const { rows } = await q(
    `SELECT j.id, j.status, j.mode, j.total, j.done, j.succeeded, j.failed, j.skipped,
            j.last_error, j.created_at, j.finished_at, j.connection_id,
            c.label AS connection_label, c.provider AS connection_provider
       FROM crm_push_jobs j LEFT JOIN crm_connections c ON c.id = j.connection_id
      WHERE j.user_id = $1 AND ($2::int IS NULL OR j.connection_id = $2)
      ORDER BY j.id DESC LIMIT $3`,
    [userId, connectionId ? Number(connectionId) : null, Math.min(Number(limit) || 20, 100)]
  );
  return rows;
}

async function requestCancel(userId, jobId) {
  const res = await q(
    `UPDATE crm_push_jobs SET cancel_requested = 1 WHERE id = $1 AND user_id = $2
       AND status IN ('queued','running','interrupted')`,
    [Number(jobId), userId]
  );
  return res.rowCount > 0;
}

async function isCancelRequested(jobId) {
  const { rows } = await q(`SELECT cancel_requested FROM crm_push_jobs WHERE id = $1`, [Number(jobId)]);
  return !!rows[0]?.cancel_requested;
}

// The failure drawer: which leads did not land, and why.
async function listFailures(userId, jobId, limit = 200) {
  const job = await getJob(userId, jobId);
  if (!job) return null;
  const { rows } = await q(
    `SELECT s.lead_id, s.error, s.attempts, s.status, l.name
       FROM crm_lead_sync s LEFT JOIN leads l ON l.id = s.lead_id
      WHERE s.user_id = $1 AND s.connection_id = $2 AND s.lead_id = ANY($3::int[])
        AND s.status = 'failed'
      ORDER BY s.lead_id LIMIT $4`,
    [userId, job.connection_id, job.lead_ids || [], Math.min(Number(limit) || 200, 1000)]
  );
  return rows;
}

// Leads of this job that failed — the work list for a retry.
async function failedLeadIds(userId, jobId) {
  const rows = await listFailures(userId, jobId, 1000);
  return (rows || []).map((r) => r.lead_id);
}

// Boot recovery: anything left 'running' by a restart is orphaned, since the
// runner lives in the web process. `cursor` is already checkpointed, so these
// resume rather than restart.
async function markInterrupted() {
  const { rows } = await q(
    `UPDATE crm_push_jobs SET status = 'interrupted'
      WHERE status = 'running' RETURNING id`
  );
  return rows.map((r) => r.id);
}

async function resumableJobIds() {
  const { rows } = await q(
    `SELECT id FROM crm_push_jobs WHERE status IN ('queued','interrupted') ORDER BY id ASC LIMIT 50`
  );
  return rows.map((r) => r.id);
}

module.exports = {
  listConnections, getConnection, getConnectionWithCredentials,
  createConnection, updateConnection, deleteConnection, mergeConfig,
  getSyncForLeads, getSyncForLead, upsertSync,
  createJob, claimJob, patchJob, getJob, getJobInternal, listJobs,
  requestCancel, isCancelRequested, listFailures, failedLeadIds,
  markInterrupted, resumableJobIds,
};
