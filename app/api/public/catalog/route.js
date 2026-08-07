import warehouse from "../../../../web/lib/warehouse.cjs";

export const dynamic = "force-dynamic";

// GET /api/public/catalog
//
// The same country/city/service tree /api/catalog serves, minus the sign-in
// requirement, so the search box on the landing page can be used before anyone
// has an account. Everything here is already public: these are the exact
// counts printed on the directory pages, and the city and service names are
// what the directory URLs are built from.
//
// It is trimmed rather than proxied. The signed-in form wants every city in
// every country; a visitor picking one place does not need a 275-entry payload
// on first paint, so cities are capped per country by size.
const MAX_CITIES_PER_COUNTRY = 60;
const MAX_SERVICES = 60;

export async function GET() {
  try {
    const data = await warehouse.catalog();

    const countries = (data.countries || [])
      .map((c) => ({
        code: c.code,
        name: c.name,
        leadCount: c.leadCount,
        cities: [...(c.cities || [])]
          .sort((a, b) => (b.leadCount || 0) - (a.leadCount || 0))
          .slice(0, MAX_CITIES_PER_COUNTRY)
          .map((city) => ({
            id: city.id,
            name: city.name,
            admin: city.admin || "",
            lat: city.lat,
            lng: city.lng,
            leadCount: city.leadCount,
          })),
      }))
      .filter((c) => c.cities.length)
      .sort((a, b) => (b.leadCount || 0) - (a.leadCount || 0));

    const services = [...(data.services || [])]
      .sort((a, b) => (b.leadCount || 0) - (a.leadCount || 0))
      .slice(0, MAX_SERVICES)
      .map((s) => ({ name: s.name, leadCount: s.leadCount }));

    return Response.json(
      { countries, services },
      {
        headers: {
          // The catalog changes only when a new area is scraped, so a minute of
          // shared cache keeps this off Postgres without going stale enough to
          // hide a city somebody just added.
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
        },
      }
    );
  } catch {
    return Response.json({ countries: [], services: [] }, { status: 200 });
  }
}
