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

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") || "").trim();
  if (!q) return Response.json({ resolved: false });
  // Set by the caller when the text, with no "in"/"near"/"," marker, already
  // names one of our own services - "spa" is also a real town in Belgium, and
  // without this the map preview jumped there for a plain service keyword.
  // See the matching guard in web/lib/geo-resolve.cjs.
  const knownService = params.get("knownService") === "1";

  try {
    const area = await geo.resolveArea(q, { allowWholeQueryFallback: !knownService });
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
