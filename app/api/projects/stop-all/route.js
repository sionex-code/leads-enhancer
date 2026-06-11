import store from "../../../../web/lib/store.cjs";

// Stop every running project (and any orphaned Lighthouse/Chrome/scrape
// processes still running in the background), not just the selected one.
export async function POST() {
  const result = store.stopAll();
  return Response.json({ ok: true, ...result });
}
