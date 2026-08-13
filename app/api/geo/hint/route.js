import { headers } from "next/headers";
import { resolveLocation } from "../../../../web/lib/geo-hint.cjs";
import geo from "../../../../web/lib/geo-catalog.cjs";

export const dynamic = "force-dynamic";

// GET /api/geo/hint -> where we think *this* request is coming from, and the
// city we would preselect from it.
//
// Diagnostic for "the form still opens on the wrong city", which cannot be
// answered from outside: `source` says whether the answer came from Cloudflare's
// location headers, from an IP lookup, or from a cached one.
//
// Returns only what the caller's own request resolves to — their own location,
// never anybody else's, and never the IP itself.
export async function GET() {
  const h = await headers();
  const where = await resolveLocation(h);
  const located = !!(where.city || (where.lat != null && where.lng != null));

  let city = null;
  if (where.countryCode && geo.available()) {
    const found =
      (where.lat != null && where.lng != null ? geo.nearestCity(where.countryCode, where.lat, where.lng) : null) ||
      (where.city ? geo.cityByName(where.countryCode, where.city) : null);
    if (found) city = { name: found.n, admin: found.s || "", distanceKm: found.distanceKm ?? null };
  }

  return Response.json(
    {
      edge: where,
      geoIndexBuilt: geo.available(),
      resolvedCity: city,
      hint: located
        ? city
          ? `Location resolved (${where.source}) and matched — the form opens on this city.`
          : `Location resolved (${where.source}) but no city in our index matched; the form falls back to the country.`
        : "No location beyond the country. Cloudflare's 'Add visitor location headers' managed transform would make this instant and free.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
