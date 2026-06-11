import store from "../../../../../web/lib/store.cjs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  try {
    return Response.json(store.loadStatus(slug));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 404 });
  }
}
