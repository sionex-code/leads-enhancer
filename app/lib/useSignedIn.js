"use client";

import { useEffect, useState } from "react";

// Who is looking at the marketing site?
//
// The session cookie is host-only to the app host, so `auth()` on the marketing
// host always reports nobody - see the long note in app/api/public/me/route.js.
// A credentialed cross-origin fetch to that route is the only way the landing
// page can tell a signed-in customer from a stranger, so this hook is the one
// place that asks, and the landing threads the answer down to whoever needs it.
//
// The answer arrives after paint, on purpose: the server render stays identical
// for everyone, which keeps the page cacheable and keeps anything personalised
// out of what a crawler indexes. Until it lands, `ready` is false and callers
// should show the signed-out treatment - a stranger seeing "Get started" for a
// moment is nothing, a customer seeing a flash of "Get started" is nothing
// either, but a stranger seeing "Open dashboard" would be a broken link.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

// On the marketing host this has to be absolute (and credentialed) to reach the
// app host's cookie. Locally, where both are one origin, the relative path is
// the same route.
const ME_URL = APP_URL ? `${APP_URL}/api/public/me` : "/api/public/me";

export default function useSignedIn() {
  const [state, setState] = useState({ ready: false, signedIn: false, label: "" });

  useEffect(() => {
    let alive = true;
    fetch(ME_URL, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setState({
          ready: true,
          signedIn: Boolean(d?.signedIn),
          label: d?.label || "",
        });
      })
      .catch(() => {
        // Offline, blocked, CORS - treat as signed out. Every CTA still works,
        // it just asks them to sign in again.
        if (alive) setState({ ready: true, signedIn: false, label: "" });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

// Absolute URL for an app-host path, for links the marketing host renders.
export function appHref(path = "/dashboard") {
  return APP_URL ? `${APP_URL}${path}` : path;
}
