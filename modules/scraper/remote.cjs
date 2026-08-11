// Map-scraper module — REMOTE backend. Runs the scrape on a worker VPS
// (SCRAPER_WORKER_URL). Because the leads DB is shared, the worker upserts rows in
// realtime (they appear in /leads live); the HTTP response carries the raw CSV back
// so the local downstream stages (enrich/whatsapp/audit) still have a file to read.
const fs = require("fs");
const path = require("path");
const { postJSON } = require("../client.cjs");
const { secretFor, workerUrlFor } = require("../registry.cjs");

// Scrapes are slow — allow a long single request by default (override via env).
const SCRAPE_TIMEOUT = Number(process.env.SCRAPER_HTTP_TIMEOUT_MS || 3600000); // 1h

async function runBatch(ctx) {
  const meta = ctx.store.readMeta(ctx.dir);
  const query = ctx.value("--query", meta.query || "");
  const max = ctx.value("--max", meta.max || "");
  if (!query) throw new Error("Scrape needs a query");
  ctx.store.writeMeta(ctx.dir, { name: ctx.projectName, slug: ctx.store.slugify(ctx.projectName), query, max });
  ctx.store.setStage(ctx.dir, "scrape", { status: "running", startedAt: new Date().toISOString(), error: "" });

  const res = await postJSON(
    workerUrlFor("scraper"),
    "/scraper/run",
    {
      query,
      max,
      project: ctx.projectName,
      userId: ctx.userId || null,
      mode: ctx.flags.has("--dom") ? "dom" : "network",
      blockCanvas: ctx.flags.has("--blockCanvas"),
      allowImages: ctx.flags.has("--allowImages"),
    },
    { secret: secretFor("scraper"), timeout: SCRAPE_TIMEOUT }
  );

  // Land the returned CSV in the project dir so enrich/whatsapp/audit can read it.
  if (res.csv && res.csv.name && res.csv.data) {
    fs.writeFileSync(path.join(ctx.dir, res.csv.name), Buffer.from(res.csv.data, "base64"));
  }
  if (ctx.log) ctx.log(`remote scrape: ${res.message || "done"}${res.rows != null ? ` (${res.rows} rows)` : ""}`);
  ctx.store.setStage(ctx.dir, "scrape", { status: "done", finishedAt: new Date().toISOString() });
}

module.exports = { runBatch };
