// Executes a CRM push.
//
// Runs in the web process, like queue.cjs's supervisor, but without a child
// process - a push is HTTP calls, not a scraper. The durability comes from the
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
const MAX_CHUNK = 500;     // ceiling, so a checkpoint still means something
const CONCURRENCY = 4;     // parallel pushes within a chunk, for adapters without a batch call
const MAX_ATTEMPTS = 3;
const AUTH_FAILURE_LIMIT = 3;  // consecutive 401/403 before we stop burning requests

// The chunk is also the most an adapter can be handed at once, so a fixed 25
// silently capped Smartlead's 400-lead batch at 25 - 80 requests for a 2000-lead
// push where 5 would do. Batch adapters get their own size; the one-at-a-time
// ones stay at 25, where a crash costs at most 25 leads of progress.
function chunkFor(adapter, config) {
  if (!adapter?.pushBatch) return CHUNK;
  const size = adapter.batchSizeFor ? adapter.batchSizeFor(config) : adapter.batchSize;
  return Math.min(MAX_CHUNK, Math.max(CHUNK, Number(size) || CHUNK));
}

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

  // The connection's settings, with anything this particular push overrode on
  // top. Validated against the adapter's `pushOverride` fields before it was
  // stored on the job, so it is not re-checked here.
  let config = {
    ...(opened.connection.config || {}),
    ...(job.source?.configOverride || {}),
    // Written by prepareDestination() the first time this job ran. Applied last
    // so a resumed push aims at the destination it already created, not at the
    // instruction to create one.
    ...(job.source?.resolvedConfig || {}),
  };
  const fieldMap = opened.connection.field_map?.length ? opened.connection.field_map : adapter.defaultFieldMap;
  const leadIds = job.lead_ids || [];

  // Some destinations do not exist until a push asks for them - Instantly can
  // be told "put these in a new list named after the LeadsFunda list", which
  // means creating that list now. Load-bearing, unlike naming the destination
  // below: without it there is nowhere to send, so a failure ends the job here
  // instead of failing every lead identically further down.
  if (adapter.prepareDestination && !job.source?.resolvedConfig) {
    const prepared = await adapter.prepareDestination(opened.credentials, config, {
      sourceName: await sourceListName(job),
    });
    if (!prepared?.ok) {
      return finish(job, "failed", prepared?.error || `Could not set up the ${adapter.label} destination.`);
    }
    if (prepared.config) {
      config = { ...config, ...prepared.config };
      const source = { ...(job.source || {}), resolvedConfig: prepared.config };
      if (prepared.destination) {
        // Named here rather than by resolveDestination(): we just created it,
        // so its name is already known and a second round trip to look it up
        // would only be a chance to get it wrong.
        source.destination = describedDestination(adapter, prepared.destination);
      }
      await store.patchJob(jobId, { source });
      job.source = source;
    }
  }

  // Resolved once, at the start, and written onto the job so the push summary
  // can say where the leads actually went. Best-effort by design: naming the
  // destination is a courtesy, and a slow or unhappy listTargets must never be
  // the reason a push does not run.
  if (!job.source?.destination) {
    const destination = await resolveDestination(adapter, opened.credentials, config);
    if (destination) {
      const source = { ...(job.source || {}), destination };
      await store.patchJob(jobId, { source });
      job.source = source;
    }
  }

  // Read after prepareDestination(), so a "new list" job scopes to the list it
  // actually created rather than to the instruction to create one.
  const destScope = adapter.destinationOf?.(config)?.value || "";

  let { done, succeeded, failed, skipped, cursor } = job;
  let authFailures = 0;
  let quotaHit = false;
  let lastError = job.last_error || null;
  const chunk = chunkFor(adapter, config);

  while (cursor < leadIds.length) {
    if (await store.isCancelRequested(jobId)) return finish(job, "cancelled", lastError, { done, succeeded, failed, skipped, cursor });

    const slice = leadIds.slice(cursor, cursor + chunk);
    const leads = await loadLeads(job.user_id, slice);
    const prevById = await store.getSyncForLeads(job.user_id, job.connection_id, slice);

    // Build the work items, dropping the ones whose payload hasn't changed
    // since their last successful push.
    const items = [];
    const results = [];
    for (const lead of leads) {
      const mapped = mapping.applyFieldMap(lead, fieldMap);
      const hash = mapping.payloadHash(mapped, destScope);
      const prev = prevById.get(lead.id) || null;

      if (!Object.keys(mapped).length) {
        results.push({ leadId: lead.id, status: "skipped", counted: "skipped", action: "skipped", error: "Nothing to send - every mapped field is empty for this lead.", payloadHash: hash });
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
      if (r.quota) quotaHit = true;
      else if (r.status === "failed" && (r.httpStatus === 401 || r.httpStatus === 403)) authFailures++;
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

    // The CRM's own allowance is spent. Every remaining lead would be refused
    // the same way, so stop - but leave the connection alone: the credentials
    // are fine, and marking it 'error' would send the user to reconnect a key
    // that was never the problem.
    if (quotaHit) return finish(job, "failed", lastError, { done, succeeded, failed, skipped, cursor });

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

// The LeadsFunda list a push came from, by name. Only a "send this list" push
// has one; a filtered or hand-picked selection does not, and the adapter
// decides what to call the destination in that case.
async function sourceListName(job) {
  const listId = job.source?.list;
  if (!listId) return null;
  try {
    return await db.getListName(job.user_id, listId);
  } catch {
    // A push must not fail because we could not read a name for it.
    return null;
  }
}

// The shape the push summary reads, built from what an adapter reports.
function describedDestination(adapter, dest) {
  const described = adapter.describeDestination?.(dest) || {};
  return {
    provider: adapter.id,
    providerLabel: adapter.label,
    kind: dest.kind,
    id: dest.id,
    label: dest.label || null,
    path: described.path || null,
    note: described.note || null,
  };
}

// What the push is aimed at, named well enough to repeat back to the user.
// The id alone is in the config already; the point of this is the label, which
// only the CRM knows.
async function resolveDestination(adapter, credentials, config) {
  if (!adapter.destinationOf) return null;
  const want = adapter.destinationOf(config);
  if (!want) return null;

  let label = null;
  try {
    const listed = await adapter.listTargets?.(credentials, config);
    if (listed?.ok) label = listed.targets?.find((t) => t.value === want.value)?.label || null;
  } catch {
    // A destination we can point at by kind but not by name is still worth
    // recording - "your Instantly campaign" beats "your CRM".
  }

  return describedDestination(adapter, { kind: want.kind, id: want.id, label });
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
//
// Pairing is by leadId wherever the adapter reports it, NOT by position: a
// batch adapter may reorder (Smartlead answers its skipped leads first), and
// pairing by index would staple one lead's payload hash onto another's ledger
// row - which then breaks dedupe silently on the next push.
function normalize(res, items) {
  const arr = Array.isArray(res) ? res : [res];
  const byLeadId = new Map();
  for (const r of arr) if (r && r.leadId != null) byLeadId.set(r.leadId, r);

  return items.map((item, i) => {
    const leadId = item.lead.id;
    const r = byLeadId.get(leadId) || (byLeadId.size ? {} : arr[i] || arr[0] || {});
    if (r.ok === false) {
      return {
        leadId, status: "failed", error: r.error || "The integration rejected this lead.",
        httpStatus: r.status, attempts: 1, payloadHash: item.payloadHash,
        // A refusal the credentials cannot fix (the CRM's own plan allowance).
        ...(r.quota ? { quota: true } : {}),
      };
    }
    if (r.skipped) {
      // The adapter declined this one (HubSpot with no email, say). It never
      // reached the CRM, so the ledger says so too.
      return { leadId, status: "skipped", counted: "skipped", action: "skipped", error: r.reason || null, attempts: 1, payloadHash: item.payloadHash };
    }
    return {
      leadId, status: "ok", action: r.action || "delivered",
      // An adapter can report a lead as landed-but-not-newly-sent (Instantly's
      // own dedupe turning one away). The ledger keeps 'ok' - it *is* in the
      // CRM - while the job summary counts it as skipped, the same split the
      // runner's own skip-unchanged path makes above.
      ...(r.counted ? { counted: r.counted } : {}),
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

module.exports = { kick, run, recover, chunkFor, CHUNK, MAX_CHUNK, CONCURRENCY, MAX_ATTEMPTS };
