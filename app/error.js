"use client";

// Route-segment error boundary. When a page or server action throws (e.g. a 500),
// Next renders this instead of an undismissable raw error overlay. It always shows
// a Close button (back to where you were / the dashboard) and a Try again button.
import { useEffect } from "react";

export default function Error({ error, reset }) {
  useEffect(() => {
    // Surface the real error in the console for debugging without blocking the UI.
    console.error("[app error boundary]", error);
  }, [error]);

  const close = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else if (typeof window !== "undefined") window.location.href = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/dashboard";
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        {/* Close button — always present so the overlay can never trap the user. */}
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>

        <div className="mb-2 flex items-center gap-2 text-red-600">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
          <h2 className="text-base font-semibold text-foreground">Something went wrong</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          The server hit an error while handling that request. You can dismiss this and keep working, or try again.
        </p>
        {error?.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">Ref: {error.digest}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
