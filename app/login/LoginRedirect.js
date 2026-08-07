"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

// Kicks off Google sign-in immediately. ?callbackUrl carries where to land after
// auth (e.g. /dashboard, or /billing?plan=p35 from a pricing CTA on the landing).
//
// The auto-redirect used to be the *only* path through this page: if it didn't
// fire — blocked redirect, a hiccup during hydration, an expired PKCE cookie
// bouncing the user back with ?error= — the page sat on its spinner forever with
// no button to press and no explanation. Everything below exists so this screen
// can never become a dead end.
const ERRORS = {
  Configuration: "Sign-in is misconfigured on our side. Please contact support.",
  AccessDenied: "Google declined the sign-in. Try again, or use a different account.",
  Verification: "That sign-in link has expired. Try again.",
  OAuthCallback: "Google sent us back an unexpected response. Try again.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
};

export default function LoginRedirect() {
  const sp = useSearchParams();
  const callbackUrl = sp.get("callbackUrl") || "/dashboard";
  const errorCode = sp.get("error") || "";
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    // Don't bounce straight back to Google after a failure — that loops the
    // user through the same error. Let them read it and choose to retry.
    if (errorCode) return;
    signIn("google", { callbackUrl });
    // If we're still here after a few seconds the redirect did not happen.
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [callbackUrl, errorCode]);

  const message = errorCode ? ERRORS[errorCode] || `Sign-in failed (${errorCode}).` : null;
  const showAction = !!errorCode || slow;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      {!errorCode && (
        <>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Redirecting to Google sign-in...</p>
        </>
      )}

      {message && (
        <p className="max-w-sm text-sm font-medium text-red-600 dark:text-red-400">{message}</p>
      )}

      {showAction && (
        <>
          <button
            onClick={() => signIn("google", { callbackUrl })}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            Continue with Google
          </button>
          <p className="max-w-sm text-xs text-muted-foreground">
            If nothing happens, your browser may be blocking the redirect or
            third-party cookies for accounts.google.com.
          </p>
        </>
      )}
    </div>
  );
}
