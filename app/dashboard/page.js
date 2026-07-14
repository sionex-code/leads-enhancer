import DashboardHome from "../dashboard-home.js";
import { auth } from "../../auth";
import { redirect } from "next/navigation";

// Authenticated app home. `?view=projects` opens the projects workspace; anything
// else (the default) shows the find-leads start page. Protected by server-side
// auth() check here (authoritative) + middleware (UX-only).
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/?signin=1");
  }
  const params = await searchParams;
  return <DashboardHome view={params?.view || ""} />;
}
