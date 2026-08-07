"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, CheckCircle2, AlertTriangle, Puzzle, X, Search, Square, Mail } from "lucide-react";
import { cn } from "../lib/utils";

// The live-search readout for a scrape running in the browser extension.
//
// This used to be a corner toast showing two weighted phases, because the
// extension also crawled every lead's website for emails before handing
// anything back. That phase now runs on the server after /ingest, so the only
// thing happening in the browser is the Google Maps search — one phase, one
// bar, and a run measured in tens of seconds rather than tens of minutes.
//
// It sits in the centre of the screen and holds a backdrop while running,
// deliberately: the scrape resolves into THIS page's callback, so navigating
// away mid-run loses leads the user has already been charged for.

// How often a queued business is revealed, and how many stay on screen.
// Businesses arrive in bursts of ~20 (a map tile resolving all at once), so
// they're paced out instead of flashing in as a block.
const REVEAL_MS = 320;
const VISIBLE = 4;
// Past this backlog the ticker is so far behind that it's showing history
// rather than progress, so it reveals several at a time to catch up.
const CATCHUP_AT = 30;

// Nothing to divide by yet (the first tiles are still in flight) -> null, which
// renders as an indeterminate bar rather than a bar stuck at 0%.
function searchPct({ scanned, scanTotal }) {
  if (!(scanTotal > 0)) return null;
  return Math.round(Math.min(1, scanned / scanTotal) * 100);
}

function formatEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const secs = Math.round(ms / 1000);
  if (secs < 10) return "a few seconds left";
  if (secs < 60) return `about ${Math.round(secs / 5) * 5}s left`;
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  if (mins >= 10) return `about ${mins}m left`;
  return rest < 10 ? `about ${mins}m left` : `about ${mins}m ${Math.round(rest / 10) * 10}s left`;
}

function initialsOf(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase();
}

// The scrolling list of businesses as they're found. Owns its own queue and
// pacing so the parent can stay a dumb pipe: it hands over each burst once,
// tagged with `seq`, and this decides how fast they appear.
function FoundTicker({ found, seq, active }) {
  const queue = useRef([]);
  const lastSeq = useRef(0);
  const [visible, setVisible] = useState([]);

  useEffect(() => {
    if (seq && seq !== lastSeq.current && Array.isArray(found)) {
      lastSeq.current = seq;
      queue.current.push(...found);
    }
  }, [seq, found]);

  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => {
      if (!queue.current.length) return;
      const take = queue.current.length > CATCHUP_AT ? 3 : 1;
      const next = queue.current.splice(0, take);
      setVisible((prev) => [...next.reverse(), ...prev].slice(0, VISIBLE));
    }, REVEAL_MS);
    return () => clearInterval(t);
  }, [active]);

  // Reset between runs, so a second search doesn't open showing the first one's
  // businesses.
  useEffect(() => {
    if (seq === 0) {
      queue.current = [];
      lastSeq.current = 0;
      setVisible([]);
    }
  }, [seq]);

  if (!visible.length) return null;

  return (
    <ul className="mt-4 space-y-1.5">
      {visible.map((biz, i) => (
        <li
          key={`${biz.name}-${i}-${visible.length}`}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5",
            // Older entries fade back so the eye lands on what just arrived.
            i === 0 ? "opacity-100" : i === 1 ? "opacity-80" : i === 2 ? "opacity-60" : "opacity-40"
          )}
        >
          {biz.photo ? (
            // Google's own storefront thumbnail, hotlinked. It is shown and then
            // forgotten — never stored on the lead — because these URLs expire.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={biz.photo}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-8 w-8 shrink-0 rounded-md object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">
              {initialsOf(biz.name)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">{biz.name}</span>
            {biz.category && (
              <span className="block truncate text-[11px] text-muted-foreground">{biz.category}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function LiveSearchOverlay({ state, onClose, onStop }) {
  // The denominator grows while pagination is queued, so a raw ratio can tick
  // backwards. A progress bar that retreats reads as a bug, so hold the high
  // water mark for this run.
  const peak = useRef(0);
  // Re-render on a timer so the countdown ticks down between progress messages,
  // which otherwise only arrive when a map tile resolves.
  const [, setNow] = useState(0);

  // Rendered into <body>, deliberately. In the tree this is written into it sits
  // inside AppShell's `overflow-x-clip` main and, on the find page, alongside a
  // `transform`ed wrapper — either of which becomes the containing block for
  // `position: fixed` and drags a "centred" panel off to somewhere it isn't.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const running = state?.status === "running";
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (!state) {
    peak.current = 0;
    return null;
  }

  const { status, phase, done, total, scanned, scanTotal, message, startedAt } = state;

  const failed = status === "error";
  const empty = status === "empty";
  const stopped = !!state.stopped;
  const timedOut = !!state.timedOut;

  if (!running) peak.current = 0;
  let pct = running ? searchPct({ scanned, scanTotal }) : null;
  if (pct != null) {
    pct = Math.max(pct, peak.current);
    peak.current = pct;
  }

  // Extrapolate from the run's own measured pace rather than a fixed guess, and
  // only once there's enough of it to mean anything — an estimate drawn from the
  // first two seconds is a random number.
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const eta =
    running && pct != null && pct >= 5 && pct < 100 && elapsed > 4000
      ? formatEta((elapsed / pct) * (100 - pct))
      : null;

  const Icon = running ? Loader2 : failed || empty ? AlertTriangle : CheckCircle2;
  const tone = failed
    ? "text-red-600 dark:text-red-400"
    : empty
      ? "text-amber-600 dark:text-amber-400"
      : running
        ? "text-primary"
        : "text-emerald-600 dark:text-emerald-400";

  const heading = failed
    ? "Live search failed"
    : empty
      ? "No leads found"
      : running
        ? state.stopping
          ? "Stopping"
          : phase === "save"
            ? "Saving leads"
            : "Searching the map"
        : stopped
          ? "Search stopped"
          : timedOut
            ? "Search wrapped up early"
            : "Live search complete";

  const detail =
    running && phase === "search" && scanTotal > 0
      ? `${Math.min(scanned, scanTotal)} of ${scanTotal} map areas scanned`
      : null;

  // What happened to emails and socials. The search no longer waits for them, so
  // the finished panel has to say where they went or their absence looks like a
  // bug.
  const enrich = state.enrich;
  const enrichNote =
    !running && !failed && !empty
      ? enrich?.queued
        ? `Finding emails and socials for ${enrich.pending} site${enrich.pending === 1 ? "" : "s"} on our servers. They will fill in on their own.`
        : state.fromCache > 0
          ? `${state.fromCache} already had contact details on file.`
          : null
      : null;

  if (!mounted) return null; // no document to portal into during SSR

  const overlay = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      // While the scrape is running the backdrop is deliberately solid to input:
      // the extension resolves its result into this page, so a stray click that
      // navigates away throws out leads the user has already been charged for.
      style={{ pointerEvents: running ? "auto" : "none" }}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity",
          running ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        role="status"
        aria-live="polite"
        style={{ pointerEvents: "auto" }}
        className="relative w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        {!running && (
          <button
            onClick={onClose}
            aria-label="Dismiss"
            className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              failed
                ? "bg-red-500/10"
                : empty
                  ? "bg-amber-500/10"
                  : running
                    ? "bg-primary/10"
                    : "bg-emerald-500/10"
            )}
          >
            <Icon className={cn("h-5 w-5", tone, running && !state.stopping && "animate-spin")} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{heading}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {message || "Working…"}
            </p>
          </div>
          {running && pct != null && (
            <span className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
              {pct}%
            </span>
          )}
        </div>

        {running && (
          <>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all duration-500",
                  pct == null && "w-1/3 animate-pulse"
                )}
                style={pct == null ? undefined : { width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
              <span className="truncate">{detail || "Warming up…"}</span>
              {eta && <span className="shrink-0">{eta}</span>}
            </div>

            <FoundTicker found={state.found} seq={state.foundSeq || 0} active={phase === "search"} />

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <Puzzle className="h-3 w-3 shrink-0" />
                <span className="truncate">Running in your browser, keep this tab open.</span>
              </span>
              <button
                onClick={onStop}
                disabled={state.stopping}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:bg-accent disabled:opacity-60"
              >
                <Square className="h-3 w-3 fill-current" />
                {state.stopping ? "Stopping…" : "Stop"}
              </button>
            </div>
          </>
        )}

        {!running && (timedOut || stopped) && (
          <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            {stopped
              ? "You stopped this search. Everything found up to that point was saved."
              : "This area was large enough that the search stopped at its time limit. Everything found so far was saved; search a tighter area for fuller coverage."}
          </p>
        )}

        {enrichNote && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            <Mail className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{enrichNote}</span>
          </p>
        )}

        {empty && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Search className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Try a broader keyword, or widen the area.</span>
          </p>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
