import LeadsClient from "./LeadsClient";

// Render per-request so the upstream nginx proxy_cache doesn't pin a year-long
// copy (see app/page.js for the full explanation).
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  // Default to the "Needs action" workflow — the unfiltered "All leads" view is
  // hidden for the SaaS launch. A `?workflow=` / `?list=` (e.g. from the Lists
  // page or the old /watchlist link) preselects that view.
  const sp = (await searchParams) || {};
  const workflow = typeof sp.workflow === "string" ? sp.workflow : "needs-action";
  const list = typeof sp.list === "string" ? sp.list : "";
  return <LeadsClient initialWorkflow={workflow} initialList={list} />;
}
