import DashboardHome from "../dashboard-home.js";

// Authenticated app home. `?view=projects` opens the projects workspace; anything
// else (the default) shows the find-leads start page. Protected by middleware +
// per-route requireUser.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  const params = await searchParams;
  return <DashboardHome view={params?.view || ""} />;
}
