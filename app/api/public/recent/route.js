import pub from "../../../../web/lib/public-searches.cjs";

export const dynamic = "force-dynamic";

// Feeds the landing page's live list. Public and unauthenticated by design -
// it returns only what the directory already publishes (city, service, country,
// row count), never a user or a typed query.
export async function GET() {
  const items = await pub.recent(12).catch(() => []);
  return Response.json(
    { items },
    {
      headers: {
        // Short shared cache: new searches surface within a few seconds without
        // every visitor's poll reaching Postgres.
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
      },
    }
  );
}
