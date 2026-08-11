import geo from "../../../../web/lib/geo-catalog.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// GET /api/geo/places                     -> { countries: [{code,name,cityCount}] }
// GET /api/geo/places?country=US&all=1    -> { cities: [...] }  every city, once
// GET /api/geo/places?country=US&q=aus    -> { cities: [...] }  server-side filter
//
// `all=1` is what the form uses: picking a country loads that country's cities in
// one request and every keystroke after that filters in memory, so the picker
// responds instantly instead of waiting on a request per character. Keys are
// short (n/s/la/ln) because at 16,731 rows the field names are a real fraction of
// the payload. The `q=` form stays for anything that wants a small response.
//
// The world city list for LIVE searches. A live scrape can grid anywhere, so
// restricting its pickers to the warehouse catalog (only places we already hold
// leads for) was an artificial limit. Warehouse searches keep using
// /api/catalog — that one is still the right answer for a warehouse lookup.
//
// Cities are queried rather than shipped: there are 152,970 of them, which is
// ~10MB and far past what a <select> can hold without locking the browser up.
//
// Behind auth like /api/catalog — it is a form affordance for signed-in users.
export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country") || "";
  const q = searchParams.get("q") || "";
  const all = searchParams.get("all") === "1";
  const limit = Number(searchParams.get("limit")) || 25;

  // Never fatal. If the index was not built on this deploy the form falls back
  // to the warehouse catalog, which is a smaller list but a working one — far
  // better than a 500 on the page's main control.
  if (!geo.available()) {
    return Response.json({ countries: [], cities: [], unavailable: true });
  }

  try {
    if (!country) {
      return Response.json({ countries: geo.countries() });
    }
    // Population is dropped from the wire: the list is already sorted by it, so
    // the order carries the ranking and the number itself is never displayed.
    const rows = all ? geo.allCities(country) : geo.searchCities(country, q, limit);
    const cities = rows.map((c) => ({ n: c.n, s: c.s, la: c.la, ln: c.ln }));
    return Response.json({ cities });
  } catch {
    return Response.json({ countries: [], cities: [], unavailable: true });
  }
}
