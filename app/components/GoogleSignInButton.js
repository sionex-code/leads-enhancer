"use client";
import { signIn } from "next-auth/react";
import { Button } from "./ui/button";

// In production the landing lives on the marketing host (leadsfunda.com) but auth
// lives on the app host (app.leadsfunda.com, = NEXTAUTH_URL). So from the landing
// we hand off to the app host's /login, which owns the OAuth flow. On the app host
// itself (or local single-host dev) we sign in right here.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

function startSignIn(callbackUrl) {
  if (APP_URL && typeof window !== "undefined") {
    try {
      if (window.location.host !== new URL(APP_URL).host) {
        window.location.href = `${APP_URL}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        return;
      }
    } catch {}
  }
  signIn("google", { callbackUrl });
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function GoogleSignInButton({ callbackUrl = "/dashboard", children, variant, size, className }) {
  return (
    <Button variant={variant} size={size} className={className} onClick={() => startSignIn(callbackUrl)}>
      <GoogleIcon />
      {children || "Sign in with Google"}
    </Button>
  );
}
