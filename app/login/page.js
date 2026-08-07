import { Suspense } from "react";
import LoginRedirect from "./LoginRedirect";

// Auth entry point for the app host (app.leadsfunda.com). The marketing landing
// links here so all Google OAuth happens on the host that owns NEXTAUTH_URL.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginRedirect />
    </Suspense>
  );
}
