import geo from "../../../../web/lib/geo-resolve.cjs";
import { requireUser } from "../../../../web/lib/session.js";

export const dynamic = "force-dynamic";

// GET /api/geo/resolve?q=plumbers+in+islamabad
//
// The find form needs to show the user where a typed search is actually going
// BEFORE they run it. Until now the map only ever followed the city dropdown,
// so typing "plumbers in islamabad" left a pin sitting on whichever city the
// select happened to hold and the map contradicted the search.
//
// Same resolver /api/projects/find uses, so the preview and the search agree
// by construction rather than by two code paths happening to match.
//
// Behind auth: it is a form affordance for signed-in users, and it fans out to
// Nominatim, whose usage policy this app has to stay inside.
export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return Response.json({ resolved: false });

  try {
    const area = await geo.resolveArea(q);
    if (!area) return Response.json({ resolved: false });
    return Response.json({
      resolved: true,
      keyword: area.keyword || "",
      place: area.shortName || "",
      display: area.display || "",
      countryCode: area.countryCode || "",
      countryName: area.countryName || "",
      lat: area.lat ?? null,
      lng: area.lng ?? null,
      bbox: area.bbox || null,
    });
  } catch {
    return Response.json({ resolved: false });
  }
}
