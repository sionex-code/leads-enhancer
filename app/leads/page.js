import LeadsClient from "./LeadsClient";

// Render per-request so the upstream nginx proxy_cache doesn't pin a year-long
// copy (see app/page.js for the full explanation).
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  // Open the leads page unfiltered by default. A `?workflow=` / `?list=` (e.g.
  // from the Lists page or old /watchlist link) still preselects that view.
  const sp = (await searchParams) || {};
  const list = typeof sp.list === "string" ? sp.list : "";
  const workflow = typeof sp.workflow === "string" ? sp.workflow : "";
  return <LeadsClient initialWorkflow={workflow} initialList={list} />;
}
