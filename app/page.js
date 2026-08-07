import Landing from "./components/Landing";
import pub from "../web/lib/public-searches.cjs";

// Public marketing landing, served to everyone — signed in or not.
//
// It used to bounce a signed-in visitor to /dashboard. That was wrong twice
// over: on the marketing host the session cookie is invisible anyway (see
// app/api/public/me/route.js) so the check never fired where it mattered, and
// where it did fire it made the landing page unreachable for the very people
// most likely to link someone to it. Signed-in state now changes the buttons,
// not the destination — Landing asks /api/public/me and swaps its sign-in CTAs
// for "Open dashboard".
export const dynamic = "force-dynamic";

export default async function Page() {
  const checkout = {
    p19: process.env.WHOP_CHECKOUT_19 || "",
    p35: process.env.WHOP_CHECKOUT_35 || "",
    p49: process.env.WHOP_CHECKOUT_49 || "",
  };
  // Public directory teasers. Never let this break the landing page — it is
  // the marketing front door and a directory outage must not take it down.
  const [recent, total] = await Promise.all([
    pub.recent(12).catch(() => []),
    pub.count().catch(() => 0),
  ]);
  return <Landing checkout={checkout} recent={recent} total={total} />;
}
