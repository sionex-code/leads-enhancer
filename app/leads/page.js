import LeadsClient from "./LeadsClient";

// Render per-request so the upstream nginx proxy_cache doesn't pin a year-long
// copy (see app/page.js for the full explanation).
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  // Default to the "Needs action" workflow — the unfiltered "All leads" view is
  // hidden for the SaaS launch. A `?workflow=` / `?list=` (e.g. from the Lists
  // page or the old /watchlist link) preselects that view.
  const sp = (await searchParams) || {};
  const list = typeof sp.list === "string" ? sp.list : "";
  // When a list is opened, don't also apply the default "needs-action" workflow —
  // the two AND together and a list whose leads aren't "needs action" would look
  // empty. An explicit ?workflow= still wins.
  const workflow = typeof sp.workflow === "string" ? sp.workflow : (list ? "" : "needs-action");
  return <LeadsClient initialWorkflow={workflow} initialList={list} />;
}
