// Executes a CRM push.
//
// Runs in the web process, like queue.cjs's supervisor, but without a child
// process — a push is HTTP calls, not a scraper. The durability comes from the
// job row: `cursor` is checkpointed after every chunk, so a restart mid-push
// resumes where it stopped instead of re-sending everything.
//
// Why not the existing job runners: site-report.cjs keeps state in a JSON file
// pruned to the newest 40 jobs *globally*, so one busy tenant would evict
// another's history; and queue.cjs's promoteOne() only knows how to spawn the
// scraper binary.
const db = require("../db.cjs");
const store = require("./store.cjs");
const crm = require("./index.cjs");
const mapping = require("./mapping.cjs");
const notifications = require("../notifications.cjs");

const CHUNK = 25;          // leads loaded and checkpointed together
const CONCURRENCY = 4;     // parallel pushes within a chunk, for adapters without a batch call
const MAX_ATTEMPTS = 3;
const AUTH_FAILURE_LIMIT = 3;  // consecutive 401/403 before we stop burning requests

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jobs this process is already working. Stops a double-submit or a boot
// recovery racing a live kick from running the same job twice; the atomic
// claim in store.claimJob is the real guarantee, this just avoids the churn.
const running = new Set();

function kick(jobId) {
  const id = Number(jobId);
  if (running.has(id)) return;
  running.add(id);
  // Deliberately not awaited: the HTTP response should not wait on the push.
  run(id)
    .catch((err) => {
      console.error(`[crm] job ${id} crashed:`, err?.message || err);
      return store.patchJob(id, { status: "failed", lastError: String(err?.message || err), finishedAt: new Date().toISOString() });
    })
    .finally(() => running.delete(id));
}

async function run(jobId) {
  const job = await store.claimJob(jobId);
  if (!job) return; // someone else claimed it, or it is already finished

  const opened = await store.getConnectionWithCredentials(job.user_id, job.connection_id);
  if (!opened.ok) {
    await store.updateConnection(job.user_id, job.connection_id, { status: "error", lastError: opened.error });
    return finish(job, "failed", opened.error);
  }
  const adapter = crm.get(opened.connection.provider);
  if (!adapter) return finish(job, "failed", "This integration type is no longer supported.");

  const config = opened.connection.config || {};
  const fieldMap = opened.connection.field_map?.length ? opened.connection.field_map : adapter.defaultFieldMap;
  const leadIds = job.lead_ids || [];

  let { done, succeeded, failed, skipped, cursor } = job;
  let authFailures = 0;
  let lastError = job.last_error || null;

  while (cursor < leadIds.length) {
    if (await store.isCancelRequested(jobId)) return finish(job, "cancelled", lastError, { done, succeeded, failed, skipped, cursor });

    const slice = leadIds.slice(cursor, cursor + CHUNK);
    const leads = await loadLeads(job.user_id, slice);
    const prevById = await store.getSyncForLeads(job.user_id, job.connection_id, slice);

    // Build the work items, dropping the ones whose payload hasn't changed
    // since their last successful push.
    const items = [];
    const results = [];
    for (const lead of leads) {
      const mapped = mapping.applyFieldMap(lead, fieldMap);
      const hash = mapping.payloadHash(mapped);
      const prev = prevById.get(lead.id) || null;

      if (!Object.keys(mapped).length) {
        results.push({ leadId: lead.id, status: "skipped", counted: "skipped", action: "skipped", error: "Nothing to send — every mapped field is empty for this lead.", payloadHash: hash });
        continue;
      }
      if (job.source?.skipUnchanged !== false && prev?.status === "ok" && prev.payload_hash === hash) {
        // Counted as skipped for this push, but the ledger still says 'ok':
        // the lead *is* in the CRM, and writing 'skipped' here would make the
        // next push think it never landed and send it all over again.
        results.push({
          leadId: lead.id, status: "ok", counted: "skipped", action: "unchanged", payloadHash: hash,
          remoteId: prev.remote_id, remoteOrgId: prev.remote_org_id, remoteUrl: prev.remote_url, attempts: 0,
        });
        continue;
      }
      items.push({
        lead, mapped, prev, payloadHash: hash,
        connectionId: job.connection_id,
        idempotencyKey: mapping.idempotencyKey(job.connection_id, lead.id, hash),
      });
    }

    const pushed = await pushItems(adapter, opened.credentials, config, items);
    for (const r of pushed) {
      results.push(r);
      if (r.status === "failed" && (r.httpStatus === 401 || r.httpStatus === 403)) authFailures++;
      else if (r.status !== "failed") authFailures = 0;
      if (r.status === "failed") lastError = r.error || lastError;
    }

    await store.upsertSync(job.user_id, job.connection_id, results);
    // `counted` is what this push did; `status` is what the ledger now says.
    // They differ for an unchanged lead: skipped here, still 'ok' there.
    for (const r of results) {
      const outcome = r.counted || r.status;
      if (outcome === "skipped") skipped++;
      else if (outcome === "ok") succeeded++;
      else failed++;
    }
    done += slice.length;
    cursor += slice.length;
    await store.patchJob(jobId, { done, succeeded, failed, skipped, cursor, lastError });

    // A dead token fails every remaining lead identically. Stop, and say so on
    // the connection so the next push is blocked before it starts.
    if (authFailures >= AUTH_FAILURE_LIMIT) {
      await store.updateConnection(job.user_id, job.connection_id, { status: "error", lastError });
      return finish(job, "failed", lastError, { done, succeeded, failed, skipped, cursor });
    }
  }

  await store.updateConnection(job.user_id, job.connection_id, { lastPushAt: new Date().toISOString() });
  return finish(job, "done", lastError, { done, succeeded, failed, skipped, cursor });
}

// Leads come back in the order given, so a batch adapter's results line up.
async function loadLeads(userId, ids) {
  const found = await Promise.all(ids.map((id) => db.getLead(userId, id)));
  return found.filter(Boolean);
}

// Batch adapters get one call per batchSize; the rest get a shared-index worker
// pool, the same shape as the domain-rating bulk route.
async function pushItems(adapter, creds, config, items) {
  if (!items.length) return [];

  if (adapter.pushBatch) {
    const size = adapter.batchSizeFor ? adapter.batchSizeFor(config) : (adapter.batchSize || items.length);
    const out = [];
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      const res = await withRetries(() => adapter.pushBatch(creds, config, batch), batch);
      out.push(...normalize(res, batch));
    }
    return out;
  }

  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      const res = await withRetries(() => adapter.pushLead(creds, config, item), [item]);
      out[i] = normalize(Array.isArray(res) ? res : [{ ...res, leadId: item.lead.id }], [item])[0];
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

// Retry only what is worth retrying: a 429 or a 5xx will likely differ next
// time, a 400 will not. Backoff matches whatsapp.cjs, honouring Retry-After.
async function withRetries(fn, batch) {
  let last;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt) {
      const wait = last?.retryAfterMs || Math.min(500 * 2 ** attempt, 8000);
      await sleep(wait);
    }
    const res = await fn();
    const arr = Array.isArray(res) ? res : [res];
    const bad = arr.find((r) => r && r.ok === false);
    if (!bad) return res;
    last = bad;
    if (!bad.retryable) return res;
  }
  return last ? (Array.isArray(batch) && batch.length > 1 ? batch.map(() => last) : last) : last;
}

// Adapters return their own shapes; the store wants one.
function normalize(res, items) {
  const arr = Array.isArray(res) ? res : [res];
  return items.map((item, i) => {
    const r = arr[i] || arr[0] || {};
    const leadId = r.leadId ?? item.lead.id;
    if (r.ok === false) {
      return {
        leadId, status: "failed", error: r.error || "The integration rejected this lead.",
        httpStatus: r.status, attempts: 1, payloadHash: item.payloadHash,
      };
    }
    if (r.skipped) {
      // The adapter declined this one (HubSpot with no email, say). It never
      // reached the CRM, so the ledger says so too.
      return { leadId, status: "skipped", counted: "skipped", action: "skipped", error: r.reason || null, attempts: 1, payloadHash: item.payloadHash };
    }
    return {
      leadId, status: "ok", action: r.action || "delivered",
      remoteId: r.remoteId ?? null, remoteOrgId: r.remoteOrgId ?? null, remoteUrl: r.remoteUrl ?? null,
      attempts: 1, payloadHash: item.payloadHash,
    };
  });
}

async function finish(job, status, lastError, counts = {}) {
  const patch = { status, lastError: lastError ?? null, finishedAt: new Date().toISOString(), ...counts };
  const saved = await store.patchJob(job.id, patch);
  // The bell survives a closed tab, which a 500-lead push will outlive.
  if (status !== "cancelled" && (counts.failed > 0 || status === "failed")) {
    try {
      await notifications.create(job.user_id, "crm_push_failed", {
        jobId: job.id, failed: counts.failed ?? 0, succeeded: counts.succeeded ?? 0, error: lastError || null,
      });
    } catch { /* a missing notification must never fail the push */ }
  }
  return saved;
}

// Called at boot from instrumentation.js. Anything left 'running' died with the
// previous process; `cursor` means those resume rather than restart.
async function recover() {
  try {
    const interrupted = await store.markInterrupted();
    const ids = await store.resumableJobIds();
    if (ids.length) console.log(`[crm] resuming ${ids.length} push job(s)${interrupted.length ? ` (${interrupted.length} interrupted by restart)` : ""}`);
    for (const id of ids) kick(id);
  } catch (err) {
    console.error("[crm] recover failed:", err?.message || err);
  }
}

module.exports = { kick, run, recover, CHUNK, CONCURRENCY, MAX_ATTEMPTS };
