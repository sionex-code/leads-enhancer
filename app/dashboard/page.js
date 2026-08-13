import { headers } from "next/headers";
import DashboardHome from "../dashboard-home.js";
import { locationFromHeaders } from "../../web/lib/geo-hint.cjs";
import geo from "../../web/lib/geo-catalog.cjs";

// Authenticated app home. `?view=projects` opens the projects workspace; anything
// else (the default) shows the find-leads start page. Protected by middleware +
// per-route requireUser.
export const dynamic = "force-dynamic";

// Turn the edge's view of the visitor into a city we can actually preselect, so
// the form opens where they are instead of on whichever city we happen to hold
// the most leads for.
//
// Coordinates first: they place someone in the city they are actually in, which
// a country code cannot. The city *name* is the fallback, because the edge's
// spelling has to match ours to be usable. Both are optional — Cloudflare only
// sends them once "Add visitor location headers" is enabled — and the whole
// thing degrades to a country hint, then to nothing.
function resolveCityHint({ countryCode, city, lat, lng }) {
  if (!countryCode || !geo.available()) return null;
  const found =
    (lat != null && lng != null ? geo.nearestCity(countryCode, lat, lng) : null) ||
    (city ? geo.cityByName(countryCode, city) : null);
  if (!found) return null;
  // The country's display name travels with it: the live picker labels its
  // search by name, not by ISO code.
  const countryName = (geo.countries().find((c) => c.code === countryCode) || {}).name || "";
  return { n: found.n, s: found.s || "", la: found.la, ln: found.ln, countryCode, countryName };
}

export default async function Page({ searchParams }) {
  const params = await searchParams;
  const where = locationFromHeaders(await headers());
  return (
    <DashboardHome
      view={params?.view || ""}
      countryHint={where.countryCode}
      cityHint={resolveCityHint(where)}
    />
  );
}
