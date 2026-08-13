"use client";

// Right-hand detail drawer for one lead. Opens on a row click in the workspace
// table; the checkbox still owns selection, so clicking a row inspects it rather
// than silently toggling a bulk action.
//
// It answers the question the table can't: *why* is this lead worth a call. The
// opportunity block lists the actual gaps, and Online Presence deliberately
// shows the absences ("Not found") as loudly as the hits — a missing Facebook
// page or missing pixel is the opening line, not an empty cell.

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Bookmark,
  Check,
  Copy,
  Globe,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Star,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn, waMeLink, mapsLink, hasDirectMapsLink } from "../../lib/utils";
import { BrandIcon } from "../SocialIcons";
import LeadAvatar from "./LeadAvatar";
import { scoreLead, isEnriched, BAND_LABEL, OPPORTUNITY_HELP } from "../../lib/opportunity";
import { InfoPopover } from "../ui/info-popover";
import trackingDetect from "../../../web/lib/tracking-detect.cjs";
import { cleanSocialUrl } from "../../../web/lib/social-urls.cjs";

// Leaflet touches `window` on import, so it can only load in the browser.
const LeadsMap = dynamic(() => import("../LeadsMap"), { ssr: false });

// Coordinates arrive from the CSV as strings, and older scrapes have none at all
// (the parser only started reading them recently), so this returns null unless
// both values are real numbers inside the valid range.
function coordsOf(lead) {
  const lat = parseFloat(lead?.lat ?? lead?.latitude);
  const lng = parseFloat(lead?.lng ?? lead?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // null island — a dropped coordinate
  return { lat, lng };
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(String(value));
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

// One "Website / Facebook / …" row: the icon plus either the link or a loud
// "Not found" chip.
function PresenceRow({ icon: Icon, network, label, href }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {Icon
          ? <Icon size={15} className={href ? "text-foreground" : "text-muted-foreground/50"} />
          : <BrandIcon network={network} size={15} className={href ? "text-foreground" : "text-muted-foreground/50"} />}
        <span className={cn("truncate", href ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Open
        </a>
      ) : (
        <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
          Not found
        </span>
      )}
    </div>
  );
}

export default function LeadDetailPanel({
  lead,
  onClose,
  onEnrich,
  onToggleFavorite,
  enriching = false,
  locked = false,
}) {
  // The drawer is only ever mounted with a lead, but never render an empty shell
  // if that ever stops being true — a blank slide-over reads as a broken app.
  if (!lead) {
    return (
      <aside className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Globe size={22} className="text-muted-foreground/60" />
        <p className="text-sm font-medium">This lead is no longer in view</p>
        <p className="text-xs text-muted-foreground">
          It may have been filtered out or removed. Pick another row to inspect it.
        </p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </aside>
    );
  }

  const { score, band, reasons, coverage } = scoreLead(lead);
  const tracking = trackingDetect.parse(lead.tech);
  // parse() returns null for "" — which means "never scanned", NOT "no pixels".
  const scanned = trackingDetect.isScanned(tracking);
  const stack = tracking ? trackingDetect.summarize(tracking) : "";
  const reviews = parseInt(String(lead.reviews ?? "").replace(/[^\d]/g, ""), 10) || 0;
  const email = lead.email || "";
  // waMeLink takes the lead, not a phone string — handing it `lead.phone` made it
  // read .whatsapp off a String, so the button was dead for every lead.
  const waHref = waMeLink(lead);
  const coords = coordsOf(lead);
  const mapsHref = mapsLink(lead);
  const mapsIsDirect = hasDirectMapsLink(lead);
  const alreadyEnriched = isEnriched(lead);

  const bandTint =
    band === "high"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : band === "medium"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border bg-muted/40";

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <LeadAvatar lead={lead} size={38} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold" title={lead.name || "Unknown"}>
            {lead.name || "Unknown"}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[lead.category, lead.city || lead.address].filter(Boolean).join(" · ") || "-"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleFavorite?.(lead)}
            title={lead.__favorited ? "Saved" : "Save lead"}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              lead.__favorited && "text-amber-500"
            )}
          >
            <Bookmark size={16} fill={lead.__favorited ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* Opportunity — the score plus the reasons behind it */}
        <div className={cn("rounded-xl border p-3", bandTint)}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp size={15} /> {BAND_LABEL[band]} Opportunity
              <InfoPopover label="How the opportunity score works" width="w-72">
                {OPPORTUNITY_HELP.map((line) => (
                  <span key={line} className="mb-2 block last:mb-0">{line}</span>
                ))}
              </InfoPopover>
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {score}
              <span className="text-xs font-normal text-muted-foreground">/100</span>
            </span>
          </div>
          {reasons.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {reasons.slice(0, 5).map((r) => (
                <li key={r} className="flex gap-1.5">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
          {/* Says how much of the picture the score is based on, so a high
              number on a barely-checked lead can't be mistaken for certainty. */}
          <div className="mt-3 border-t border-current/10 pt-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Signal coverage</span>
              <span className="tabular-nums">{coverage}%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-current/10">
              <div className="h-full rounded-full bg-current opacity-40" style={{ width: `${coverage}%` }} />
            </div>
            {/* Only prompt when Enrich genuinely hasn't run and there is a site
                to run it against. Coverage stays low for an already-enriched lead
                whose site was unreachable (or that has no website), so gating on
                coverage told people to re-run something they had already done. */}
            {!alreadyEnriched && lead.website && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">Run Enrich to check pixels, socials and site health.</p>
            )}
            {alreadyEnriched && coverage < 60 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Enriched. The rest of the picture needs a site audit.
              </p>
            )}
          </div>
        </div>

        <Section title="Contact">
          <div className="flex items-center gap-2 text-sm">
            <Phone size={15} className="shrink-0 text-muted-foreground" />
            {lead.phone ? (
              <>
                <a href={`tel:${lead.phone}`} className="truncate font-medium hover:underline">
                  {lead.phone}
                </a>
                <CopyButton value={lead.phone} />
              </>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Mail size={15} className="shrink-0 text-muted-foreground" />
            {email ? (
              locked ? (
                <span className="truncate text-muted-foreground" title="Upgrade your plan to reveal contact details">
                  •••••••@{String(email).split("@")[1] || "…"}
                </span>
              ) : (
                <>
                  <a href={`mailto:${email}`} className="truncate hover:underline" title={email}>
                    {email}
                  </a>
                  <CopyButton value={email} />
                </>
              )
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        </Section>

        <Section title="Online presence">
          <div className="divide-y divide-border/60">
            <PresenceRow icon={Globe} label="Website" href={lead.website} />
            <PresenceRow icon={Mail} label="Email" href={email ? `mailto:${email}` : ""} />
            {/* Validated here too: a stored directory index or share link is
                not a profile, and "Not found" is the accurate answer for it. */}
            <PresenceRow network="facebook" label="Facebook" href={cleanSocialUrl(lead.facebook, "facebook")} />
            <PresenceRow network="instagram" label="Instagram" href={cleanSocialUrl(lead.instagram, "instagram")} />
            <PresenceRow network="linkedin" label="LinkedIn" href={cleanSocialUrl(lead.linkedin, "linkedin")} />
          </div>
        </Section>

        {/* Marketing stack — what enrichment found running on their site. The
            absence of a pixel is the sales hook, so say it in words. */}
        <Section title="Marketing stack">
          {!lead.website ? (
            <p className="text-xs text-muted-foreground">No website to scan.</p>
          ) : !scanned ? (
            <p className="text-xs text-muted-foreground">Not scanned yet. Run Enrich to detect pixels and analytics.</p>
          ) : (
            <div className="space-y-2">
              {stack ? (
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ...(tracking.adPixels || []),
                    ...(tracking.analytics || []),
                    ...(tracking.platform || []),
                    ...(tracking.marketing || []),
                    ...(tracking.commerce || []),
                  ].map((name) => (
                    <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                // A scanned site running nothing at all is the strongest pitch in
                // the drawer, so say it as a finding rather than as an empty state.
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  No tracking of any kind on this site.
                </p>
              )}
              {trackingDetect.missing(tracking).map((gap) => (
                <p key={gap} className="text-xs text-amber-600 dark:text-amber-400">
                  {gap}
                </p>
              ))}
            </div>
          )}
        </Section>

        <Section title="Reviews">
          <div className="flex items-center gap-2 text-sm">
            <Star size={15} className={reviews ? "text-amber-500" : "text-muted-foreground"} fill={reviews ? "currentColor" : "none"} />
            <span className="font-medium">
              {reviews.toLocaleString()} review{reviews === 1 ? "" : "s"}
            </span>
            {lead.rating && reviews > 0 && <span className="text-muted-foreground">· {lead.rating} average</span>}
          </div>
          {reviews === 0 && <p className="text-xs text-muted-foreground">No reviews found</p>}
        </Section>

        <Section title="Location">
          {/* Only scrapes that captured coordinates can be plotted; the rest still
              get the address and a Maps link below, rather than an empty frame. */}
          {coords && (
            // wheelZoom off: the map sits inside a scrolling panel, where the
            // wheel belongs to the panel. A small radius just sets the zoom —
            // LeadsMap already drops its own pin on the centre.
            <LeadsMap center={coords} radiusKm={0.3} height={150} wheelZoom={false} />
          )}
          <div className="flex items-start gap-2 text-sm">
            <MapPin size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
            {mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 hover:underline"
                title={mapsIsDirect ? "Open this listing on Google Maps" : "Search for this business on Google Maps"}
              >
                {lead.address || "View location"}
              </a>
            ) : (
              <span className="min-w-0 flex-1">{lead.address || "-"}</span>
            )}
            <CopyButton value={lead.address} />
          </div>
        </Section>
      </div>

      {/* Actions pinned under the content — always reachable, however long
          the detail list gets. */}
      <div className="shrink-0 space-y-2 border-t border-border p-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!lead.website || enriching} onClick={() => onEnrich?.(lead)}>
            {enriching ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />} Enrich Lead
          </Button>
          <Button
            disabled={!waHref}
            onClick={() => waHref && window.open(waHref, "_blank", "noopener,noreferrer")}
          >
            <MessageCircle size={15} /> WhatsApp
          </Button>
        </div>
        {/* Always offer the map. When the scrape captured the canonical listing
            URL we go straight there; otherwise mapsLink() falls back to a Maps
            search on name + address, which beats showing no link at all. */}
        {mapsHref ? (
          <Button variant="ghost" className="w-full" asChild>
            <a href={mapsHref} target="_blank" rel="noreferrer">
              <MapPin size={15} /> {mapsIsDirect ? "View on Google Maps" : "Find on Google Maps"}
            </a>
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
