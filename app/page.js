import { redirect } from "next/navigation";
import { auth } from "../auth";
import Landing from "./components/Landing";

// Public marketing landing. Signed-in users are sent straight to the app.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const checkout = {
    p19: process.env.WHOP_CHECKOUT_19 || "",
    p35: process.env.WHOP_CHECKOUT_35 || "",
    p49: process.env.WHOP_CHECKOUT_49 || "",
  };
  return <Landing checkout={checkout} />;
}
