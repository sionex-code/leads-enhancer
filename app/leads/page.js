import LeadsClient from "./LeadsClient";

// Render per-request so the upstream nginx proxy_cache doesn't pin a year-long
// copy (see app/page.js for the full explanation).
export const dynamic = "force-dynamic";

export default function Page() {
  // Default to the "Needs action" workflow — the unfiltered "All leads" view is
  // hidden for the SaaS launch.
  return <LeadsClient initialWorkflow="needs-action" />;
}
