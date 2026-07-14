"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";

// Kicks off Google sign-in immediately. ?callbackUrl carries where to land after
// auth (e.g. /dashboard, or /billing?plan=p35 from a pricing CTA on the landing).
//
// IMPORTANT: We must avoid firing signIn() repeatedly in a loop. If the session
// cookie was set by the OAuth callback but the middleware didn't detect it (a
// common reverse-proxy / NEXTAUTH_URL mismatch issue), /login would otherwise
// re-trigger signIn on every render, creating an infinite redirect loop. We guard
// with useSession + a ref to ensure signIn fires at most once, and if a session
// is already present we short-circuit straight to the callbackUrl.
export default function LoginRedirect() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const fired = useRef(false);
  const callbackUrl = sp.get("callbackUrl") || "/dashboard";
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status === "loading") return;

    if (status === "authenticated" && session) {
      router.replace(callbackUrl);
      return;
    }

    if (fired.current) return;
    fired.current = true;

    const t = setTimeout(() => {
      signIn("google", { callbackUrl })
        .catch(() => setError(true));
    }, 100);

    return () => clearTimeout(t);
  }, [status, session, callbackUrl, router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Sign-in failed. <button className="underline text-primary" onClick={() => window.location.reload()}>Try again</button></p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      Redirecting to Google sign-in...
    </div>
  );
}
