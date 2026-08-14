import crm from "../../../../web/lib/crm/index.cjs";
import mapping from "../../../../web/lib/crm/mapping.cjs";
import { requireUser } from "../../../../web/lib/session.js";
import { DEV_AUTH_ENABLED } from "../../../../web/lib/dev-auth.js";

export const dynamic = "force-dynamic";

// What the connect UI needs to render each provider's form: credential fields,
// settings, and the lead columns a field map may draw from.
export async function GET() {
  if (!DEV_AUTH_ENABLED) {
    const { response } = await requireUser();
    if (response) return response;
  }
  return Response.json({
    providers: crm.list(),
    sources: [...mapping.SOURCE_COLUMNS].sort(),
    transforms: mapping.TRANSFORM_NAMES,
  });
}
