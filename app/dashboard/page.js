import { headers } from "next/headers";
import DashboardHome from "../dashboard-home.js";
import { countryFromHeaders } from "../../web/lib/geo-hint.cjs";

// Authenticated app home. `?view=projects` opens the projects workspace; anything
// else (the default) shows the find-leads start page. Protected by middleware +
// per-route requireUser.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }) {
  const params = await searchParams;
  // Seeds the country select so the form doesn't open on the United States for
  // a user in Pakistan. Empty when we can't tell, and the form falls back.
  const countryHint = countryFromHeaders(await headers());
  return <DashboardHome view={params?.view || ""} countryHint={countryHint} />;
}
