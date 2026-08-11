"use client";

// A lead's brand mark: the website's own favicon when we have one, falling back
// to the initials tile.
//
// Two sources, in order:
//  1. `lead.favicon` — the real <link rel="icon"> captured during enrichment.
//  2. Google's favicon service, keyed on the domain — so a lead shows its icon
//     the moment it is scraped, without waiting for an enrich pass.
// If both fail to load (dead site, no icon, blocked request) it falls back to
// initials rather than leaving a broken image in the row.

import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

function domainOf(lead) {
  const raw = lead?.domain || lead?.website || "";
  if (!raw) return "";
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function initialsOf(name) {
  return (
    String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export default function LeadAvatar({ lead, size = 32, className = "" }) {
  const domain = domainOf(lead);
  // Ordered candidates; a failed load advances to the next one.
  const sources = [
    lead?.favicon,
    domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : "",
  ].filter(Boolean);
  const [attempt, setAttempt] = useState(0);

  // A new lead in the same row slot must restart the fallback chain, otherwise
  // one broken icon permanently downgrades every lead that reuses the element.
  useEffect(() => setAttempt(0), [lead?.favicon, domain]);

  const src = sources[attempt];
  const style = { width: size, height: size };

  if (!src) {
    return (
      <span
        style={style}
        className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary", className)}
        aria-hidden="true"
      >
        {initialsOf(lead?.name)}
      </span>
    );
  }

  return (
    <span
      style={style}
      className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card", className)}
    >
      {/* Plain <img>: these are arbitrary third-party hosts, which next/image
          would need configured domains for. */}
      <img
        src={src}
        alt=""
        loading="lazy"
        width={size - 10}
        height={size - 10}
        className="object-contain"
        onError={() => setAttempt((n) => n + 1)}
      />
    </span>
  );
}
