import store from "../../../web/lib/store.cjs";
import { requireUser } from "../../../web/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, response } = await requireUser();
  if (response) return response;
  return Response.json({ projects: store.listProjects(userId) });
}
