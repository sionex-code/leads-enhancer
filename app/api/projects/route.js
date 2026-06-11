import store from "../../../web/lib/store.cjs";

export async function GET() {
  return Response.json({ projects: store.listProjects() });
}
