"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

// Kicks off Google sign-in immediately. ?callbackUrl carries where to land after
// auth (e.g. /dashboard, or /billing?plan=p35 from a pricing CTA on the landing).
export default function LoginRedirect() {
  const sp = useSearchParams();
  useEffect(() => {
    const cb = sp.get("callbackUrl") || "/dashboard";
    signIn("google", { callbackUrl: cb });
  }, [sp]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      Redirecting to Google sign-in...
    </div>
  );
}
