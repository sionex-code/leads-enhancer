import geo from "../../../../web/lib/geo-resolve.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// GET /api/geo/reverse?lat=33.6844&lng=73.0479 -> { resolved, place, ... }
//
// Backs "Use my location" on the find form. The browser gives coordinates; the
// search box needs a name. Resolving against the warehouse city list instead
// would only ever return somewhere we already hold leads — Pakistan has three
// such cities, so a user in Islamabad would be told they are in Gujrat
// District. A real place name lets the live search go wherever they are.
//
// Behind auth and sharing the resolver's Nominatim client, for the same reason
// /api/geo/resolve is: this app has a usage policy to stay inside.
export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ resolved: false });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return Response.json({ resolved: false });
  }

  try {
    const area = await geo.reverseGeocode(lat, lng);
    if (!area) return Response.json({ resolved: false });
    return Response.json({
      resolved: true,
      place: area.place,
      display: area.display,
      countryCode: area.countryCode,
      countryName: area.countryName,
      lat: area.lat,
      lng: area.lng,
    });
  } catch {
    return Response.json({ resolved: false });
  }
}
