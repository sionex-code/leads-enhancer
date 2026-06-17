import LeadsClient from "../leads/LeadsClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return <LeadsClient initialWorkflow="watchlist" pageTitle="Watch list" activeNav="watchlist" />;
}
