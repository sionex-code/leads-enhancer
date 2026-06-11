import Dashboard from "./dashboard";

// Render per-request (no long-lived static cache). Without this, Next emits
// Cache-Control: s-maxage=31536000 on the prerendered page, which the upstream
// nginx proxy_cache then holds for a year — so redeploys wouldn't show up.
export const dynamic = "force-dynamic";

export default function Page() {
  return <Dashboard />;
}
