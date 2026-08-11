"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MapPin,
  Loader2,
  Puzzle,
  Star,
  ArrowRight,
  Square,
  Download,
  Check,
  Briefcase,
  Globe,
  ChevronDown,
} from "lucide-react";
import { detectExtension, scrapeWithExtension } from "../lib/extension-client";
import { cn } from "../lib/utils";

// Search from the landing page, before anyone has an account.
//
// The scrape runs in the visitor's own browser through the extension, so this
// costs us no CPU, no bandwidth and no credits, and it needs no session. That
// is the whole reason it can be offered publicly at all.
//
// The contact columns are shortened before they are drawn. Be clear about what
// that is: the visitor scraped these rows themselves and already holds every
// value in their own tab, so this is a presentation choice about what the
// product hands over ready-to-use, not a security control. Nothing here is
// protecting a secret. The server-side masking on /directory is the real one,
// because there the data is ours and the visitor never had it.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const MAX_PUBLIC_RESULTS = 40;
const RADIUS_KM = 12;
// The search is the long pole; the website crawl that follows owns the rest of
// the bar so it never restarts at zero.
const SEARCH_SHARE = 0.7;

// The catalog stores services lowercase ("general contractor"). Sentence case
// in a control that sits at the top of the page reads as unfinished, so they
// are cased for display only — the value posted is still the catalog's.
const titleCase = (s) =>
  String(s || "").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 0) return "";
  return "•".repeat(6) + s.slice(at);
}

function maskPhone(phone) {
  const s = String(phone || "").trim();
  if (!s) return "";
  const keep = s.startsWith("+") ? s.slice(0, 4) : s.slice(0, 3);
  return `${keep} ••• ••••••`;
}

function maskWebsite(site) {
  const s = String(site || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  if (!s) return "";
  const dot = s.lastIndexOf(".");
  if (dot < 1) return s.slice(0, 4) + "•••";
  return s.slice(0, Math.min(4, dot)) + "•••" + s.slice(dot);
}

// A labelled select that carries its own icon.
//
// The icon sits in the padding, not in the flow, and the native chevron is
// suppressed for a drawn one — a bare <select> renders three different control
// shapes across Chrome, Safari and Firefox, and the row has to look like one
// designed component in all of them. It is still a real <select>, so the
// keyboard, the mobile wheel picker and screen readers all behave normally.
function Field({ label, icon: Icon, children, ...selectProps }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[1.05rem] w-[1.05rem] -translate-y-1/2 text-muted-foreground" />
        <select
          {...selectProps}
          className="h-[3.25rem] w-full appearance-none rounded-xl border border-border bg-card pl-11 pr-10 text-[0.95rem] font-medium text-foreground outline-none transition hover:border-border/80 focus:border-primary focus:ring-2 focus:ring-primary/15"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}

export default function PublicSearch({ signedIn = false }) {
  const [catalog, setCatalog] = useState(null);
  const [countryCode, setCountryCode] = useState("");
  const [cityId, setCityId] = useState("");
  const [service, setService] = useState("");

  const [status, setStatus] = useState("idle"); // idle | running | done | empty | error | needs-extension
  const [progress, setProgress] = useState({ phase: "search", found: 0, pct: null });
  // The enrich phase reports websites-checked, not businesses-found, so the
  // headline count has to be remembered from the search phase.
  const progressFound = useRef(0);
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState("");
  const abortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.countries?.length) return;
        setCatalog(d);
        setCountryCode(d.countries[0].code);
        setCityId(String(d.countries[0].cities[0]?.id ?? ""));
        setService(d.services[0]?.name || "");
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const country = useMemo(
    () => catalog?.countries.find((c) => c.code === countryCode) || null,
    [catalog, countryCode]
  );
  const city = useMemo(
    () => country?.cities.find((c) => String(c.id) === String(cityId)) || country?.cities[0] || null,
    [country, cityId]
  );

  // Keep the city valid when the country changes, or the picker silently keeps
  // a city from the previous country and the search runs in the wrong place.
  useEffect(() => {
    if (country && !country.cities.some((c) => String(c.id) === String(cityId))) {
      setCityId(String(country.cities[0]?.id ?? ""));
    }
  }, [country, cityId]);

  const ready = Boolean(city && service);
  const running = status === "running";

  async function run() {
    if (!ready || running) return;
    setMessage("");
    setRows([]);

    const version = await detectExtension();
    if (!version) {
      setStatus("needs-extension");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running");
    setProgress({ phase: "search", found: 0, pct: null });
    progressFound.current = 0;

    try {
      const { rows: found } = await scrapeWithExtension(
        {
          query: `${service} in ${city.name}`,
          centerLat: city.lat,
          centerLng: city.lng,
          radiusKm: RADIUS_KM,
          max: MAX_PUBLIC_RESULTS,
          // Signed-in searches hand their rows to the server and it does the
          // website crawl. Nothing is handed over here, so there is no server
          // side to do it: an anonymous visitor's leads are enriched by their
          // own extension or not at all. We are not spending VPS time crawling
          // websites for somebody who has not signed in.
          enrich: true,
        },
        {
          signal: controller.signal,
          onProgress: ({ phase, done, total, scanned, scanTotal }) => {
            setProgress({
              phase: phase || "search",
              found: phase === "enrich" ? progressFound.current : done || 0,
              done: done || 0,
              total: total || 0,
              pct:
                phase === "enrich"
                  ? total > 0
                    ? Math.round((SEARCH_SHARE + (1 - SEARCH_SHARE) * (done / total)) * 100)
                    : 100
                  : scanTotal > 0
                    ? Math.round(Math.min(1, scanned / scanTotal) * SEARCH_SHARE * 100)
                    : null,
            });
            if (phase !== "enrich") progressFound.current = done || 0;
          },
        }
      );
      const list = (found || []).filter((r) => r?.name).slice(0, MAX_PUBLIC_RESULTS);
      setRows(list);
      setStatus(list.length ? "done" : "empty");
    } catch (err) {
      setMessage(err?.message || "The search stopped unexpectedly.");
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="mx-auto mt-7 w-full max-w-[62.5rem]">
      <div className="rounded-[1.25rem] border border-border/70 bg-card p-5 text-left shadow-[0_18px_50px_-24px_rgba(1,59,47,0.28)] sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-3">
          <Field
            label="What you sell to"
            icon={Briefcase}
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            {(catalog?.services || []).map((s) => (
              <option key={s.name} value={s.name}>{titleCase(s.name)}</option>
            ))}
            {!catalog && <option>Loading</option>}
          </Field>
          <Field
            label="Country"
            icon={Globe}
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
          >
            {(catalog?.countries || []).map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
            {!catalog && <option>Loading</option>}
          </Field>
          <Field
            label="City"
            icon={MapPin}
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
          >
            {(country?.cities || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.admin ? `, ${c.admin}` : ""}
              </option>
            ))}
            {!country && <option>Loading</option>}
          </Field>
          <button
            type="button"
            onClick={running ? () => abortRef.current?.abort() : run}
            disabled={!ready && !running}
            className={cn(
              "inline-flex h-[3.25rem] shrink-0 items-center justify-center gap-2 rounded-xl px-7 text-[0.95rem] font-semibold transition",
              running
                ? "border border-border bg-card text-foreground hover:bg-accent"
                : "bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.6)] hover:opacity-90 disabled:opacity-50"
            )}
          >
            {running ? (
              <><Square className="h-3.5 w-3.5 fill-current" /> Stop</>
            ) : (
              <><Search className="h-[1.15rem] w-[1.15rem]" /> Search</>
            )}
          </button>
        </div>

        {running && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all duration-500",
                  progress.pct == null && "w-1/3 animate-pulse"
                )}
                style={progress.pct == null ? undefined : { width: `${progress.pct}%` }}
              />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progress.phase === "enrich"
                ? `Checking websites for contact details (${progress.done} of ${progress.total})`
                : `${progress.found} businesses found in ${city?.name}`}
            </p>
          </div>
        )}

        {/* The search is the first thing on the page now, so this panel is what
            most visitors meet first. It has to answer "why am I being asked to
            install something?" on the spot — a bare "get the extension" button
            in front of a stranger reads as a hurdle, not as the reason the
            search is free. */}
        {status === "needs-extension" && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Puzzle className="h-4 w-4 text-primary" />
              One-time setup: add the browser extension
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              The search runs inside your own browser rather than on our servers.
              That is exactly why you can run one here without an account, and
              the extension is the part that does it.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                About two minutes, guided step by step
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                Works in Chrome, Edge, Brave, Opera and Vivaldi
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                Free, and you only do it once
              </li>
            </ul>
            <a
              href={`${APP_URL}/extension?from=search`}
              className="mt-3.5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Show me how
            </a>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Already installed it? Reload this page, because a new extension can&apos;t
              reach tabs that were already open.
            </p>
          </div>
        )}

        {status === "empty" && (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing came back for {service} in {city?.name}. Try another city or a broader category.
          </p>
        )}
        {status === "error" && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{message}</p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              {rows.length} {service} businesses in {city?.name}
            </p>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              found just now
            </span>
          </div>

          <ul className="divide-y divide-border/60">
            {rows.slice(0, 12).map((r, i) => (
              <li key={`${r.name}-${i}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.category || "Business"}
                      {r.address ? ` · ${String(r.address).split(",")[0]}` : ""}
                    </p>
                  </div>
                  {r.rating && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {r.rating}
                      {r.reviews ? (
                        <span className="text-muted-foreground">({Number(r.reviews).toLocaleString()})</span>
                      ) : null}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>{maskWebsite(r.website) || "no website"}</span>
                  {/* Only ever a real address, shortened. Composing one from
                      the domain would put an email on screen that may not
                      exist, and the user would find that out by sending to it. */}
                  <span>{maskEmail(r.email) || "no email found"}</span>
                  <span>{maskPhone(r.phone) || "no phone"}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* Someone already signed in has nothing to sign in to. Asking them
              to would send them through an OAuth round-trip to land where a
              plain link puts them. */}
          <div className="border-t border-border bg-muted/30 px-4 py-5 text-center">
            <p className="text-sm font-semibold text-foreground">
              {signedIn
                ? `Run this search in your dashboard to keep all ${rows.length} leads`
                : `Sign in to save these ${rows.length} leads`}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {signedIn
                ? "The dashboard keeps the list, fills in the full websites, emails and phone numbers, and exports it to CSV."
                : "Signing in keeps this list, fills in the full websites, emails and phone numbers, and lets you export it."}
            </p>
            <a
              href={`${APP_URL}${signedIn ? "/dashboard" : "/login"}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              {signedIn ? "Open dashboard" : "Sign in to save this list"}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
