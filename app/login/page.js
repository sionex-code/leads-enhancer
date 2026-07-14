import { Suspense } from "react";
import LoginRedirect from "./LoginRedirect";
import { auth } from "../../auth";
import { redirect } from "next/navigation";

// Auth entry point for the app host (app.leadsfunda.com). The marketing landing
// links here so all Google OAuth happens on the host that owns NEXTAUTH_URL.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }
  return (
    <Suspense fallback={null}>
      <LoginRedirect />
    </Suspense>
  );
}
