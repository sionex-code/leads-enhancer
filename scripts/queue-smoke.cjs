// Headless test of the queue concurrency cap + promotion + notifications.
// Stubs the filesystem/spawn parts of store so no real runner is launched.
const store = require("../web/lib/store.cjs");
const queue = require("../web/lib/queue.cjs");
const { pool } = require("../web/lib/pg.cjs");

// --- stub store side effects ---
store.ensureDir = () => {};
store.writeMeta = () => {};
store.writeState = () => {};
store.safeProjectDir = (s) => "/tmp/" + s;
store.loadStatus = () => ({ state: { stages: {} } });
const alive = new Set();
let pidc = 100000;
store.spawnRunner = (p) => {
  const pid = ++pidc;
  alive.add(pid);
  return { pid, slug: p.name, name: p.name };
};
store.processAlive = (pid) => alive.has(Number(pid));
store.killTree = (pid) => alive.delete(Number(pid));

const counts = async (uid) => {
  const { rows } = await pool().query(
    "select status, count(*)::int c from jobs where user_id=$1 group by status order by status",
    [uid]
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.c]));
};

(async () => {
  // Clean slate (dev DB): remove any stray jobs so the global cap is deterministic.
  await pool().query("DELETE FROM jobs");
  const uid = "qtest-" + Date.now();
  await pool().query("INSERT INTO users (id,email) VALUES ($1,$2)", [uid, uid + "@e.com"]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Drive ticks to a steady state. Each manual tick is fully awaited and we pause
  // between them so the _ticking guard is always clear (robust to Tokyo latency:
  // each promotion is several sequential round-trips). Stops when the slot cap is
  // reached or the queue is drained.
  const settle = async (label) => {
    let c;
    for (let i = 0; i < 15; i++) {
      await queue.tick();
      c = await counts(uid);
      if ((c.running || 0) >= queue.MAX_CONCURRENT || (c.queued || 0) === 0) break;
      await sleep(300);
    }
    console.log(label, c, "| alive", alive.size);
    return c;
  };

  for (let i = 0; i < 8; i++) {
    await queue.enqueue(uid, { name: "proj" + i, query: "x", stages: ["scrape"] });
  }
  await sleep(2000); // let any mid-enqueue auto-tick finish so the guard is clear
  await settle("after enqueue (expect running=6, queued=2):");

  // Simulate 3 runners finishing → 3 freed slots get the 2 remaining queued.
  [...alive].slice(0, 3).forEach((p) => alive.delete(p));
  await settle("after 3 finished (expect running=5, queued=0):");

  const n = await pool().query("select count(*)::int c from notifications where user_id=$1", [uid]);
  console.log("notifications (done) so far:", n.rows[0].c, "(expect 3)");

  // Finish the rest.
  alive.clear();
  await settle("after all finished (expect running=0):");

  // cleanup
  await pool().query("DELETE FROM users WHERE id=$1", [uid]);
  await pool().query("DELETE FROM jobs WHERE user_id=$1", [uid]);
  await pool().end();
  console.log("DONE");
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
