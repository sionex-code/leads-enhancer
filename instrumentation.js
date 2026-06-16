// Next.js startup hook. Runs once when the server process boots. We start the
// job-queue supervisor here (Node runtime only — never on the edge), so a single
// loop promotes queued scrape/enrich jobs up to the global concurrency cap.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Converge the DB schema (credits, proxies, enrichment cache, settings) before
  // anything reads it. Idempotent + self-guarding, so it's safe on every boot.
  try {
    const { ensureSchema } = await import("./web/lib/migrate.cjs");
    await ensureSchema();
  } catch (err) {
    console.error("[instrumentation] schema migrate skipped:", err?.message || err);
  }
  const queue = (await import("./web/lib/queue.cjs")).default;
  queue.start();
}
