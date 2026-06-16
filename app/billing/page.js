import { redirect } from "next/navigation";
import { auth } from "../../auth";
import BillingClient from "./BillingClient";

// Authenticated billing page. Protected by middleware + this server-side check.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <BillingClient />;
}
