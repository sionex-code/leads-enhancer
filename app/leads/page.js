import LeadsClient from "./LeadsClient";

// Render per-request so the upstream nginx proxy_cache doesn't pin a year-long
// copy (see app/page.js for the full explanation).
export const dynamic = "force-dynamic";

export default function Page() {
  return <LeadsClient />;
}
