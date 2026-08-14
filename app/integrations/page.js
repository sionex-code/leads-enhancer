import { redirect } from "next/navigation";
import { auth } from "../../auth";
import IntegrationsClient from "./IntegrationsClient";

// Authenticated integrations page. Protected by middleware + this server-side
// check, the same pair /billing uses.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <IntegrationsClient />;
}
