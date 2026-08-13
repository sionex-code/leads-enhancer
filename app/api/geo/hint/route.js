import { headers } from "next/headers";
import { locationFromHeaders } from "../../../../web/lib/geo-hint.cjs";
import geo from "../../../../web/lib/geo-catalog.cjs";

export const dynamic = "force-dynamic";

// GET /api/geo/hint -> what the edge says about *this* request, and the city we
// would preselect from it.
//
// Diagnostic for "the form still opens on the wrong city". The city hint depends
// on Cloudflare's "Add visitor location headers" managed transform, which is
// available on every plan but off by default, so the useful question is whether
// those headers arrived at all — and there is no way to answer it from outside.
//
// Returns only what the caller's own request carries: their own IP-derived
// location, never anybody else's, and never the IP itself.
export async function GET() {
  const h = await headers();
  const where = locationFromHeaders(h);
  const hasCityHeaders = !!(where.city || (where.lat != null && where.lng != null));

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
      hint: hasCityHeaders
        ? city
          ? "City headers present and matched — the form will open on this city."
          : "City headers present but no city in our index matched; the form falls back to the country."
        : "No city headers. Enable Cloudflare -> Rules -> Settings -> Managed Transforms -> 'Add visitor location headers' to get city-level defaults.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
