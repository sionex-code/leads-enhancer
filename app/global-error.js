"use client";

// Top-level error boundary: catches errors thrown in the root layout itself
// (where the regular app/error.js can't render). Must supply its own <html>/<body>.
// Keeps a Close button so a 500 never leaves the user stuck on a dead screen.
import "./tailwind.css";

export default function GlobalError({ error, reset }) {
  const close = () => {
    if (typeof window !== "undefined") {
      window.location.href = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/dashboard";
    }
  };
  return (
    <html lang="en">
      <body>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
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
            <h2 className="mb-2 text-base font-semibold text-foreground">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">A server error occurred. Dismiss this and keep working, or try again.</p>
            {error?.digest && <p className="mt-2 font-mono text-[11px] text-muted-foreground">Ref: {error.digest}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent">Close</button>
              <button type="button" onClick={() => reset()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">Try again</button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
