// Global job queue + supervisor. Scrape/enrich runs are no longer spawned
// immediately; they're persisted as rows in the `jobs` table and a single
// in-process supervisor promotes them so that at most MAX_CONCURRENT run at once
// (across ALL users). The rest wait as `queued`. When a runner finishes, a
// `notifications` row is written so the user is told it's done.
//
// One supervisor runs per server process (pm2 runs a single Node process); it is
// started from instrumentation.js. State lives in Postgres so a restart resumes
// cleanly: orphaned `running` jobs whose pid is gone are reconciled on the next tick.
const { pool } = require("./pg.cjs");
const store = require("./store.cjs");

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_JOBS || 6);
const TICK_MS = Number(process.env.QUEUE_TICK_MS || 2000);

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

// Mark finished any `running` job whose runner process has exited. Decides
// done vs failed by inspecting the project's on-disk state, then notifies.
async function reapFinished() {
  const { rows } = await pool().query(
    `SELECT id, user_id, project_slug, params, pid FROM jobs WHERE status = 'running'`
  );
  if (process.env.QUEUE_DEBUG === "1") {
    console.log("[queue] reap: running jobs", rows.map((r) => ({ id: r.id, pid: r.pid, alive: r.pid ? store.processAlive(r.pid) : null })));
  }
  for (const job of rows) {
    // A job with no pid yet was just claimed (spawn in flight) — leave it.
    if (job.pid === null || job.pid === undefined) continue;
    if (store.processAlive(job.pid)) continue;

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
      `SELECT id, user_id, params FROM jobs
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

module.exports = { start, enqueue, tick, listJobs, cancel, queuePosition, MAX_CONCURRENT };
