"use client";

import { useEffect, useState } from "react";
import { ArrowRight, MapPin, Building2, TrendingUp } from "lucide-react";
import RelativeTime from "./RelativeTime";

// ISO-3166 alpha-2 to flag emoji, by offsetting each letter into the regional
// indicator block. No image assets, no lookup table to fall out of date.
function flagOf(code) {
  const cc = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const titleCase = (s) =>
  String(s || "").trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "Recently searched" on the landing page. Each card is a public URL, so this
// doubles as the crawlable entry point into the directory: without it those
// pages exist but nothing links to them.
//
// These are aggregates only, so nothing here identifies who ran a search. The
// city, service, country and row count are the same four facts the directory
// page itself publishes, and attribution is a first name plus a last initial.
//
// `me` is the anonymised label of whoever is signed in, or "" — the landing
// page asks /api/public/me once (see app/lib/useSignedIn.js) and hands the
// answer down, so a signed-in visitor recognises their own searches in the list
// without this section making a second request for the same fact.
export default function RecentSearches({ items = [], total = 0, me = "" }) {
  // Server-rendered items paint first, so the section is in the HTML a crawler
  // sees. Polling then keeps it current: a search that finishes now shows up
  // here without the visitor reloading.
  const [live, setLive] = useState(items);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/public/recent")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d && Array.isArray(d.items) && d.items.length) setLive(d.items);
        })
        .catch(() => {});
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!live.length) return null;

  return (
    <section id="directory" className="border-y border-border/60 bg-muted/20 py-24">
      <div className="container px-4">
        <div className="mb-10 text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground/80 shadow-sm">
            {/* A pulsing dot is honest here: the list really does re-poll, so it
                should look alive rather than static. */}
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live directory
          </span>
          {me && (
            <p className="mb-3 text-sm text-muted-foreground">
              Signed in as <span className="font-semibold text-foreground">{me}</span>.
              Your searches appear here the same way.
            </p>
          )}
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Lists people are building right now
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Every search becomes a browsable list. Open one to see the businesses,
            their ratings and their areas.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((e) => {
            const fresh = e.searches > 0;
            return (
              <a
                key={e.slug}
                href={`/directory/${e.slug}`}
                className={
                  "group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md " +
                  (fresh ? "border-primary/50 ring-1 ring-primary/15" : "border-border hover:border-primary/40")
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    {flagOf(e.countryCode) ? (
                      <span aria-hidden="true" className="shrink-0 text-xl leading-none">
                        {flagOf(e.countryCode)}
                      </span>
                    ) : (
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {e.cityName}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {e.countryName || e.countryCode}
                      </span>
                    </span>
                  </span>
                  {fresh && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      New
                    </span>
                  )}
                </div>

                <span className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
                    {e.leadCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">businesses</span>
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground/90">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{titleCase(e.service)}</span>
                </span>

                {/* "Searched" is claimed only for entries somebody actually ran.
                    The rest were seeded from existing coverage, and labelling
                    those "searched 2 seconds ago" would be inventing activity.
                    "Updated" is what genuinely happened to them. */}
                <span className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px]">
                  {e.lastSeen ? (
                    <span className={fresh ? "font-medium text-primary" : "text-muted-foreground"}>
                      {fresh ? "Searched" : "Updated"} <RelativeTime iso={e.lastSeen} />
                      {e.searcher ? (
                        <span className="text-muted-foreground"> by {e.searcher}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">In the directory</span>
                  )}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </span>
              </a>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <a
            href="/directory"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-accent"
          >
            <TrendingUp className="h-4 w-4" />
            {/* Counted from the same query that fills the index, so the number
                on the button and the number of pages behind it cannot drift. */}
            Browse {total > 0 ? `all ${total.toLocaleString()} lists` : "the full directory"}
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
