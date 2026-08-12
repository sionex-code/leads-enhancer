"use client";

import Link from "next/link";
import { Download, Puzzle, ShieldCheck, X, Zap } from "lucide-react";

// Shown when a search needs a live Google Maps scrape but the browser
// extension isn't installed. Live scraping runs in the user's own browser, so
// without the extension there is nothing to run it — this explains why rather
// than just failing.
export default function ExtensionRequiredDialog({
  open,
  onClose,
  title = "Install the browser extension to finish this search",
  body = "We didn’t have these leads stored yet, so they need to be pulled from the map live. That runs in your own browser through our free Chrome extension. It takes about a minute to set up, once.",
}) {
  if (!open) return null;

  return (
    <div
      className="lf fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ext-required-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
          <Puzzle className="h-6 w-6 text-primary" />
        </div>

        <h2 id="ext-required-title" className="text-xl font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>

        <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium text-foreground">Faster searches.</span>{" "}
              No queue, so you aren&apos;t waiting behind other people&apos;s scrapes.
            </span>
          </li>
          <li className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium text-foreground">Your searches stay yours.</span>{" "}
              The scrape runs on your machine; we only store the leads you keep.
            </span>
          </li>
        </ul>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/extension"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Install the extension
          </Link>
          <button
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent"
          >
            Not now
          </button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Already installed? Reload this page so the extension can connect, then
          run the search again.
        </p>
      </div>
    </div>
  );
}
