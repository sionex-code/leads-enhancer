import AdminClient from "./AdminClient";
import AdminLogin from "./AdminLogin";
import { isAdminAuthed } from "../../web/lib/admin-auth.js";

// Standalone admin panel. Gated by its own username/password (ADMIN_USERNAME /
// ADMIN_PASSWORD) via a signed cookie — independent of Google sign-in.
export const dynamic = "force-dynamic";

export default async function Page() {
  const authed = await isAdminAuthed();
  return authed ? <AdminClient /> : <AdminLogin />;
}
