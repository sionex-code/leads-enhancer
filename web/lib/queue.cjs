// Global job queue + supervisor. Scrape/enrich runs are no longer spawned
// immediately; they're persisted as rows in the `jobs` table and a single
// in-process supervisor promotes them so that at most MAX_CONCURRENT run at once
// (across ALL users). The rest wait as `queued`. When a runner finishes, a
// `notifications` row is written so the user is told it's done.
//
// One supervisor runs per server process (pm2 runs a single Node process); it is
// started from instrumentation.js. State lives in Postgres so a restart resumes
// cleanly: orphaned `running` jobs whose pid is gone are reconciled on the next tick.
const os = require("os");
const { pool } = require("./pg.cjs");
const store = require("./store.cjs");

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_JOBS || 12);
const TICK_MS = Number(process.env.QUEUE_TICK_MS || 2000);
// How long a claimed-but-not-yet-spawned job (status=running, pid=null) may sit
// before we treat the spawn as dead and free its slot. promoteOne sets the pid
// within milliseconds of claiming, so anything older than this never spawned
// (supervisor died mid-promote, spawn threw before pid write, etc.) and would
// otherwise hold a concurrency slot forever — the cause of "waiting for a free
// slot" with nothing actually running.
const STALE_CLAIM_MS = Number(process.env.QUEUE_STALE_CLAIM_MS || 120000);
// Hard ceiling on how long a single runner may hold a concurrency slot. A runner
// that hangs (e.g. Chrome stuck during an audit) would otherwise pin its slot
// forever and, once all slots are pinned, wedge the whole queue on "waiting for a
// free slot". Generous by default so a legitimately long scrape isn't killed.
const MAX_RUN_MS = Number(process.env.QUEUE_MAX_RUN_MS || 6 * 60 * 60 * 1000);

let _timer = null;
let _ticking = false;

// Add a job. Writes a queued project state so the dashboard shows it immediately,
// then inserts the jobs row. Returns { jobId, position }.
async function enqueue(userId, payload) {
  const name = payload.name;
  const slug = store.slugify(name);
  // Surface the project as "queued" right away.
  const dir = store.safeProjectDir(name, userId);
  store.ensureDir(dir);
  store.writeMeta(dir, { name, slug, query: payload.query || "", max: payload.max || "" });
  store.writeState(dir, {
    running: false,
    queued: true,
    activePid: null,
    message: "Queued — waiting for a free slot",
  });

  const { rows } = await pool().query(
    `INSERT INTO jobs (user_id, project_slug, type, status, params, priority)
     VALUES ($1, $2, $3, 'queued', $4, $5) RETURNING id`,
    [userId, slug, payload.type || "scrape", payload, Number(payload.priority || 0)]
  );
  const jobId = rows[0].id;
  // Kick the supervisor so a free slot is used without waiting a full tick.
  setImmediate(() => tick().catch(() => {}));
  const position = await queuePosition(jobId);
  return { jobId, position, slug };
}

// How many queued jobs are ahead of this one (0 = next up).
async function queuePosition(jobId) {
  const { rows } = await pool().query(
    `SELECT COUNT(*)::int AS ahead FROM jobs
      WHERE status = 'queued' AND id < $1`,
    [jobId]
  );
  return rows[0].ahead;
}

async function runningCount() {
  const { rows } = await pool().query(`SELECT COUNT(*)::int AS c FROM jobs WHERE status = 'running'`);
  return rows[0].c;
}

// Once a job leaves the queue (finished, failed, or its slot reclaimed) the
// project's web-state must stop advertising itself as "queued". The runner clears
// running/activePid on exit but never resets the enqueue-time `queued` flag — which
// is exactly what left finished projects stuck showing "waiting for a free slot".
function clearQueuedFlag(slug, userId, extra = {}) {
  try {
    store.writeState(store.safeProjectDir(slug, userId), { queued: false, ...extra });
  } catch {
    // best-effort: a state write failure must not break job reaping.
  }
}

// Mark finished any `running` job whose runner process has exited. Decides
// done vs failed by inspecting the project's on-disk state, then notifies.
async function reapFinished() {
  const { rows } = await pool().query(
    `SELECT id, user_id, project_slug, params, pid, started_at FROM jobs WHERE status = 'running'`
  );
  if (process.env.QUEUE_DEBUG === "1") {
    console.log("[queue] reap: running jobs", rows.map((r) => ({ id: r.id, pid: r.pid, alive: r.pid ? store.processAlive(r.pid) : null })));
  }
  for (const job of rows) {
    // A job with no pid yet was just claimed (spawn in flight) — leave it for a
    // short grace period, but if it's been pid-less longer than that the spawn
    // never completed and the slot would leak forever, so fail it to free the slot.
    if (job.pid === null || job.pid === undefined) {
      const ageMs = job.started_at ? Date.now() - new Date(job.started_at).getTime() : Infinity;
      if (ageMs < STALE_CLAIM_MS) continue;
      await pool().query(
        `UPDATE jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
        ["spawn never started (no pid) — slot reclaimed", job.id]
      );
      await pool().query(
        `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'job_failed', $2)`,
        [job.user_id, { jobId: job.id, slug: job.project_slug, name: job.params?.name || job.project_slug, status: "failed", error: "spawn never started" }]
      );
      clearQueuedFlag(job.project_slug, job.user_id, {
        running: false, activePid: null, message: "Failed: runner never started", finishedAt: new Date().toISOString(),
      });
      continue;
    }
    if (store.processAlive(job.pid)) {
      // The pid is alive — but is it actually OUR runner? The runner records its
      // own pid as the project's activePid in web-state.json. After a reboot the OS
      // can hand that pid to an unrelated process; without this check we'd treat the
      // stranger as a live job forever and never free the slot. A light state read
      // (no CSV parsing) keeps this cheap on every tick.
      let ours = true;
      try {
        const st = store.readState(store.safeProjectDir(job.project_slug, job.user_id));
        ours = st && st.activePid != null && Number(st.activePid) === Number(job.pid);
      } catch {}
      // A job that started before the machine last booted cannot still be running —
      // its runner died in the reboot — even if a recycled pid now looks alive and
      // the (never-cleared) activePid still matches. This is the real fix for slots
      // that stay pinned forever after a server restart.
      const bootMs = Date.now() - os.uptime() * 1000;
      if (job.started_at && new Date(job.started_at).getTime() < bootMs) ours = false;
      const ageMs = job.started_at ? Date.now() - new Date(job.started_at).getTime() : 0;
      // Genuinely ours and within the runtime ceiling → it's a healthy running job.
      if (ours && ageMs < MAX_RUN_MS) continue;
      // Ours but stuck past the ceiling → kill it so the slot can be reused. (If the
      // pid isn't ours we must NOT kill it — just reclaim the row below.)
      if (ours && ageMs >= MAX_RUN_MS) {
        try { store.killTree(job.pid); } catch {}
        await pool().query(
          `UPDATE jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
          ["runner exceeded max runtime — slot reclaimed", job.id]
        );
        await pool().query(
          `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'job_failed', $2)`,
          [job.user_id, { jobId: job.id, slug: job.project_slug, name: job.params?.name || job.project_slug, status: "failed", error: "exceeded max runtime" }]
        );
        clearQueuedFlag(job.project_slug, job.user_id, { running: false, activePid: null });
        continue;
      }
      if (!ours) {
        // pid belongs to someone else now (reused after reboot) — reclaim the slot
        // without touching that process, then fall through to settle done/failed.
      }
    }

    let status = "done";
    let error = null;
    try {
      const st = store.loadStatus(job.project_slug, job.user_id);
      const stages = st.state?.stages || {};
      const failed = Object.values(stages).find((s) => s && s.status === "error");
      if (failed) {
        status = "failed";
        error = String(failed.error || "stage failed").slice(0, 500);
      }
    } catch {}

    await pool().query(
      `UPDATE jobs SET status = $1, error = $2, finished_at = now() WHERE id = $3`,
      [status, error, job.id]
    );
    // Runner already wrote running:false + the final message; just clear the
    // leftover queued flag so the project stops showing "waiting for a free slot".
    clearQueuedFlag(job.project_slug, job.user_id);
    await pool().query(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1, $2, $3)`,
      [
        job.user_id,
        status === "done" ? "job_done" : "job_failed",
        { jobId: job.id, slug: job.project_slug, name: job.params?.name || job.project_slug, status, error },
      ]
    );
  }
}

// Claim the oldest queued job atomically (FOR UPDATE SKIP LOCKED) and spawn its
// runner. Returns true if a job was promoted.
async function promoteOne() {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, user_id, project_slug, params FROM jobs
        WHERE status = 'queued'
        ORDER BY priority DESC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    const job = rows[0];
    if (!job) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      `UPDATE jobs SET status = 'running', started_at = now() WHERE id = $1`,
      [job.id]
    );
    await client.query("COMMIT");

    // Spawn outside the transaction. If the spawn throws, mark the job failed.
    try {
      const { pid } = store.spawnRunner({ ...job.params, userId: job.user_id });
      await pool().query(`UPDATE jobs SET pid = $1 WHERE id = $2`, [pid, job.id]);
    } catch (err) {
      await pool().query(
        `UPDATE jobs SET status = 'failed', error = $1, finished_at = now() WHERE id = $2`,
        [String(err.message || err).slice(0, 500), job.id]
      );
      clearQueuedFlag(job.project_slug, job.user_id, {
        running: false, activePid: null, message: `Failed: ${String(err.message || err).slice(0, 200)}`, finishedAt: new Date().toISOString(),
      });
      await pool().query(
        `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'job_failed', $2)`,
        [job.user_id, { jobId: job.id, status: "failed", error: String(err.message || err).slice(0, 200) }]
      );
    }
    return true;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

const DEBUG = process.env.QUEUE_DEBUG === "1";

async function tick() {
  if (_ticking) return;
  _ticking = true;
  try {
    await reapFinished();
    let running = await runningCount();
    if (DEBUG) console.log("[queue] tick start, running =", running);
    while (running < MAX_CONCURRENT) {
      const promoted = await promoteOne();
      if (DEBUG) console.log("[queue]   promoteOne ->", promoted, "running now", running + (promoted ? 1 : 0));
      if (!promoted) break;
      running++;
    }
  } catch (err) {
    console.error("[queue] tick error:", err.message, err.stack);
  } finally {
    _ticking = false;
  }
}

// Idempotent: start the single supervisor loop.
function start() {
  if (_timer) return;
  console.log(`[queue] supervisor started (max ${MAX_CONCURRENT} concurrent)`);
  _timer = setInterval(() => tick().catch(() => {}), TICK_MS);
  _timer.unref?.();
  // Run one tick promptly to reconcile any leftover state on boot.
  setImmediate(() => tick().catch(() => {}));
}

// Self-heal: make sure the supervisor is running and nudge it now. Called fire-
// and-forget from frequently-polled routes (project status, jobs list) so that
// even if the background interval never started (e.g. the instrumentation hook
// didn't run in this process), a queued job still gets promoted instead of being
// stuck on "waiting for a free slot" forever. Cheap: start() is idempotent and
// tick() guards against overlapping runs.
function kick() {
  try {
    start();
    setImmediate(() => tick().catch(() => {}));
  } catch {}
}

// Admin: every queued/running job across ALL users, with the owner's email, for
// the admin "running operations" view. Most-recently-started first.
async function listActiveJobs(limit = 200) {
  const { rows } = await pool().query(
    `SELECT j.id, j.user_id, j.project_slug, j.type, j.status, j.params, j.pid,
            j.created_at, j.started_at, u.email, u.name
       FROM jobs j
       LEFT JOIN users u ON u.id = j.user_id
      WHERE j.status IN ('queued', 'running')
      ORDER BY (j.status = 'running') DESC, j.started_at DESC NULLS LAST, j.id DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    name: r.name,
    project: (r.params && r.params.name) || r.project_slug,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    startedAt: r.started_at,
  }));
}

// List a user's jobs (most recent first) for the dashboard.
async function listJobs(userId, limit = 50) {
  const { rows } = await pool().query(
    `SELECT id, project_slug, type, status, error, created_at, started_at, finished_at
       FROM jobs WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

// Cancel a queued/running job for a user. Kills the runner if running.
async function cancel(userId, jobId) {
  const { rows } = await pool().query(
    `SELECT id, status, pid FROM jobs WHERE id = $1 AND user_id = $2`,
    [Number(jobId), userId]
  );
  const job = rows[0];
  if (!job) return { ok: false, error: "not found" };
  if (job.pid && store.processAlive(job.pid)) store.killTree(job.pid);
  await pool().query(
    `UPDATE jobs SET status = 'canceled', finished_at = now() WHERE id = $1`,
    [job.id]
  );
  return { ok: true };
}

// Cancel every queued/running job for one of a user's projects. Used by the Stop
// route so a job that's still QUEUED (no runner yet) doesn't get promoted and
// resurrect the project right after the user stopped it, and so a running job's
// slot is freed immediately instead of waiting for the next reap. The actual
// runner process is killed by the caller (store.killTree / store.stopAll).
async function cancelByProject(userId, slug) {
  const { rowCount } = await pool().query(
    `UPDATE jobs SET status = 'canceled', finished_at = now()
      WHERE user_id = $1 AND project_slug = $2 AND status IN ('queued', 'running')`,
    [userId, slug]
  );
  if (rowCount) setImmediate(() => tick().catch(() => {}));
  return rowCount || 0;
}

// Cancel ALL of a user's queued/running jobs (Stop all). Frees every slot they
// hold at once; the runners themselves are killed by store.stopAll.
async function cancelAllForUser(userId) {
  const { rowCount } = await pool().query(
    `UPDATE jobs SET status = 'canceled', finished_at = now()
      WHERE user_id = $1 AND status IN ('queued', 'running')`,
    [userId]
  );
  // A freed slot should be filled right away rather than on the next tick.
  setImmediate(() => tick().catch(() => {}));
  return rowCount || 0;
}

module.exports = { start, kick, enqueue, tick, listJobs, listActiveJobs, cancel, cancelByProject, cancelAllForUser, queuePosition, MAX_CONCURRENT };
