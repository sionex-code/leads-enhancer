"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "./components/app/AppShell";
import AnimatedNumber from "./components/AnimatedNumber";
import ListsDialog from "./components/leads/ListsDialog";
import { useMe } from "./components/AccountWidget";
import { QUICK_COUNTRIES, QUICK_SERVICES } from "./lib/quickSearchData";
import { detectExtension, scrapeWithExtension } from "./lib/extension-client";
import useExtension from "./lib/useExtension";
import ExtensionRequiredDialog from "./components/ExtensionRequiredDialog";
import LiveSearchOverlay from "./components/LiveSearchOverlay";
import {
  CheckCircle2,
  X,
  Clock3,
  Globe2,
  ListPlus,
  Loader2,
  AlertTriangle,
  Puzzle,
  Download,
  Mail,
  MailCheck,
  MessageCircle,
  PauseCircle,
  OctagonX,
  Search,
  Send,
  Star,
  Trash2,
  Zap,
  Database,
  Briefcase,
  ChevronDown,
  CreditCard,
  ArrowRight,
  SlidersHorizontal,
  Share2,
  TrendingUp,
  MapPin,
  MoreHorizontal,
  LocateFixed,
  Monitor,
  Smartphone,
} from "lucide-react";

import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Progress } from "./components/ui/progress";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Sheet, SheetContent } from "./components/ui/sheet";
import BottomDock from "./components/ui/bottom-dock";
import { cn, waMeLink, waState, prettyEnrichStatus } from "./lib/utils";
import { Socials, WaIcon, WaPhone } from "./components/SocialIcons";
import LeadDetailPanel from "./components/leads/LeadDetailPanel";
import LeadAvatar from "./components/leads/LeadAvatar";
import FilterSelect from "./components/leads/FilterSelect";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./components/ui/dropdown-menu";
import { scoreLead, BAND_LABEL, BAND_CLASS, BAND_RING, OPPORTUNITY_HELP } from "./lib/opportunity";
import { InfoPopover } from "./components/ui/info-popover";
import { SHOW_CREDITS } from "../web/lib/credits-ui.cjs";
import trackingDetect from "../web/lib/tracking-detect.cjs";

const LeadsMap = dynamic(() => import("./components/LeadsMap"), { ssr: false });

// Guided tour for the "Find leads" page — walks through the search controls in
// order. Targets are data-tour attributes on the form (works on mobile since they
// are all on-screen). Passed to AppShell as tourKey="find".
const FIND_TOUR = [
  { key: "find-service", title: "Pick a service", body: "Choose the type of business you want to reach, such as plumbers, dentists, real estate agencies, and so on." },
  { key: "find-country", title: "Choose a country", body: "Pick the country to search in. The city list below updates to match." },
  { key: "find-city", title: "Pick a city", body: "Select a city, or choose \"All cities\" to search the whole country at once." },
  { key: "find-rating", title: "Filter by rating", body: "Target top-rated businesses, or pick \"Below 4.0\" to find low-rated ones that need help, which is a great angle for selling websites or reputation services." },
  { key: "find-max", title: "How many leads", body: SHOW_CREDITS
    ? "Set how many leads to pull (up to 10,000). You're only charged 1 credit per brand-new lead."
    : "Set how many leads to pull (up to 10,000). Leads you already own are merged rather than pulled again." },
  { key: "find-radius", title: "Search radius", body: "Widen or tighten the search area around the center. \"All cities\" makes it country-wide." },
  { key: "find-map", title: "Refine the center", body: "Drag the pin to move the exact search center. The circle shows your radius." },
  { key: "find-submit", title: "Find leads", body: "Hit Find leads and we'll pull matching businesses straight into your project." },
];

// Walkthrough for the projects workspace (shown after leads are found). Explains
// the outreach workflow for first-timers: enrich, WhatsApp, page-speed audits,
// reports, plus where saved leads and lists live. Auto-opens once per browser
// (tourKey "workspace") and replays from the topbar "Tour" button.
const WORKSPACE_TOUR = [
  { key: "", title: "Your leads workspace", body: "You found leads. Here's how to enrich them, spot the weak websites, and turn them into outreach." },
  { key: "ws-enrich", title: "Enrich", body: "Grab each lead's email address and social profiles automatically by crawling their website. This button does it for every captured lead at once." },
  { key: "ws-whatsapp", title: "Check WhatsApp", body: "See which leads' phone numbers are active on WhatsApp, so you know who you can message directly." },
  { key: "ws-leads", title: "Per-lead actions", body: "Every row has quick actions: grab email & socials, check WhatsApp, run a website page-speed audit (desktop + mobile Performance / SEO scores), and generate a full website report. Tick the checkboxes to audit or report many leads at once." },
  { key: "nav-leads", title: "All your leads", body: "Every lead you capture across projects is saved here under Leads." },
  { key: "nav-lists", title: "Build lists", body: "Group leads into Lists to organize your outreach campaigns." },
];

const blankForm = {
  name: "Austin Real Estate Leads",
  query: "real estate agency Austin TX",
  max: "20",
  device: "all",
  enrichConcurrency: "16",
  auditConcurrency: "2",
  network: true, // fast network capture (read leads off the Maps RPC) vs legacy DOM clicking
  headless: false, // run Chrome with no visible window
  blockCanvas: false, // skip map rendering to save CPU/GPU
  blockImages: true, // skip downloading images/media/fonts (lighter + faster)
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const AUDIT_COST = 3; // credits per quick audit (mirrors billing.AUDIT_COST)
const REPORT_COST = 10; // credits per website report (mirrors billing.REPORT_COST)
const WORKSPACE_PAGE_SIZE = 50; // captured-leads table page size

// Mirror of the server-side slugify so we can match the typed project name to a
// project in the list (and know if THAT project — not the selected one — is busy).
function slugify(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 70) || "project"
  );
}

// Title-case a service label for display (values sent to the warehouse stay raw).
function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Shared rating/reviews rule (matches the Leads page): show the review count
// (0 when empty), and only show a star rating when there is at least one review.
function reviewCount(lead) {
  const n = Number(lead.reviews);
  return Number.isFinite(n) ? n : 0;
}
function showRating(lead) {
  return lead.rating != null && lead.rating !== "" && reviewCount(lead) > 0;
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    err.code = data.code;
    err.status = res.status;
    err.resetAt = data.resetAt;
    err.tz = data.tz;
    throw err;
  }
  return data;
}

// Lighthouse scores are 0-100, higher is better. Same buckets Google uses.
function scoreClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n >= 90) return "good";
  if (n >= 50) return "avg";
  return "poor";
}

const SCORE_TONE = {
  good: "bg-emerald-500/15 text-emerald-600",
  avg: "bg-amber-500/15 text-amber-600",
  poor: "bg-red-500/15 text-red-600",
};

function Score({ label, value }) {
  if (value === "" || value === null || value === undefined)
    return <span className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{label} -</span>;
  const tone = SCORE_TONE[scoreClass(value)] || "bg-muted/60 text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", tone)} title={`${label}: ${value}/100 (real-Chrome audit)`}>
      {label} {value}
    </span>
  );
}

// Colorful social chips + WhatsApp badge/phone live in ./components/SocialIcons
// (Socials, WaIcon, WaPhone) and are shared with the Leads manager.

// Per-row actions on the captured-leads table: grab email/socials, check
// WhatsApp, run a quick audit (Health scores), open the website report, and
// remove from this list. Matches the Leads-manager row actions for consistency.
// Build a Google Maps link for a lead: prefer its captured Maps URL, else fall
// back to a Maps search by business name + address so every row is clickable.
function leadMapsHref(lead) {
  if (lead.mapsUrl || lead.maps_url) return lead.mapsUrl || lead.maps_url;
  const q = [lead.name, lead.address || lead.city || ""].filter(Boolean).join(" ").trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

// Per-row actions, trimmed to the two that act on the row itself: enrich, and
// remove. The map pin went because the lead's name is already the map link, and
// the WhatsApp check moved onto the phone number itself (see WaPhone's onCheck).
// Audit and report are bulk operations on the selection bar rather than per row.
// Everything a row can do that isn't save-to-favorites or add-to-list. Those two
// stay on the row because they happen constantly; enrich, message and remove
// live behind a menu, because three more icon buttons per row multiplied by
// fifty rows is what made the old table read as noise rather than data.
function RowActionsMenu({ lead, busy = {}, onEnrich, onRemove }) {
  const waLink = waMeLink(lead);
  // Enriched = the website crawl has run (email/socials found, or it reported a
  // status like "no email"), so a finished row can say so rather than inviting
  // the same click again.
  const enriched = !!(lead.email || lead.enrichStatus || lead.enrich_status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[13rem]">
        <DropdownMenuItem
          disabled={!lead.website || busy.enrich}
          onClick={() => onEnrich(lead)}
          className={cn(!lead.website && "pointer-events-none opacity-50")}
        >
          {busy.enrich ? <Loader2 size={14} className="animate-spin" /> : enriched ? <MailCheck size={14} className="text-emerald-600" /> : <Mail size={14} />}
          {enriched ? "Re-grab email + socials" : "Grab email + socials"}
        </DropdownMenuItem>
        {waLink && (
          <DropdownMenuItem asChild>
            <a href={waLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              <Send size={14} className="text-emerald-600" /> Message on WhatsApp
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive hover:bg-destructive/10" onClick={() => onRemove(lead)}>
          <Trash2 size={14} /> Remove from project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CapturedActions({ lead, busy = {}, onEnrich, onRemove }) {
  const waLink = waMeLink(lead);
  // Enriched = the website crawl has run (email/socials found, or it reported a
  // status like "no email"). Show a green check so a finished row reads as done.
  const enriched = !!(lead.email || lead.enrichStatus || lead.enrich_status);
  return (
    <>
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", enriched && "text-emerald-600")} title={enriched ? "Enriched: re-grab email + socials" : "Grab email + socials"} disabled={!lead.website || busy.enrich} onClick={() => onEnrich(lead)}>
        {busy.enrich ? <Loader2 size={14} className="animate-spin" /> : enriched ? <MailCheck size={14} /> : <Mail size={14} />}
      </Button>
      {waLink && (
        <a
          href={waLink}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Message on WhatsApp (${waLink.replace(/^https?:\/\//, "")})`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-600 transition hover:bg-emerald-500/10"
        >
          <Send size={14} />
        </a>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600" title="Remove from this list" onClick={() => onRemove(lead)}>
        <Trash2 size={14} />
      </Button>
    </>
  );
}

// Dismissible "grabbed N leads" success alert shown after a find completes.
// Dismisses on Esc, or a tap/click anywhere on the backdrop.
function FindResultAlert({ result, onClose }) {
  useEffect(() => {
    if (!result) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, onClose]);
  if (!result) return null;
  const { inserted = 0, updated = 0 } = result;
  // What the user actually pulled into this project (deduped), NOT the warehouse's
  // full match count — that can be far larger than the requested max (e.g. 8,763
  // available but you only grabbed your 900).
  const grabbed = inserted + updated;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/30 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-emerald-500/40 bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Grabbed {grabbed.toLocaleString()} {grabbed === 1 ? "lead" : "leads"}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              <b className="text-foreground">{Number(inserted).toLocaleString()}</b> new · <b className="text-foreground">{Number(updated).toLocaleString()}</b> already saved (no extra charge).
            </p>
          </div>
          <button onClick={onClose} aria-label="Dismiss" className="text-muted-foreground transition-colors hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">Tap anywhere or press Esc to dismiss</p>
      </div>
    </div>
  );
}

const STAGE_TONE = {
  running: "warning",
  done: "success",
  error: "destructive",
  starting: "secondary",
};

function formatDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "calculating";
  const minutes = Math.ceil(n / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function EnrichProgress({ progress, stage }) {
  const status = stage?.status || progress?.status || "idle";
  if (!progress || (!progress.totalSites && status !== "running")) return null;
  if (status === "idle" && !progress.processedSites) return null;
  // Finished work is not progress. Once the stage reports done with nothing left
  // to process, this card is just a stale "done / 0 remaining" panel sitting on
  // top of the results the user actually came back for — so it retires itself.
  // Errors stay put: a failed run is exactly when you need the numbers.
  if (status === "done" && !progress.remaining) return null;
  const eta = status === "running" ? formatDuration(progress.etaSeconds) : progress.remaining ? "not running" : "done";
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <strong className="text-sm font-medium">Enrichment progress</strong>
            <span className="text-xs text-muted-foreground">
              {progress.runDone}/{progress.runTotal || progress.totalSites} sites this run
            </span>
          </div>
          <Badge variant={STAGE_TONE[status] || "outline"} className="capitalize">{status}</Badge>
        </div>
        <Progress value={progress.percent || 0} indicatorClassName="bg-primary" />
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock3 size={13} /> ETA {eta}</span>
          <span>{progress.remaining} remaining</span>
          <span>{progress.withEmail} with email</span>
          <span>{progress.processedSites}/{progress.totalSites} processed overall</span>
        </div>
      </CardContent>
    </Card>
  );
}

// A live search can only filter by rating *after* the engine returns, so asking
// for exactly `max` businesses and then discarding most of them is how "below
// 4.0" comes back empty. Maps results skew high — in the warehouse's Adelaide
// data only ~8% of general contractors sit under 4.0 — so 30 scraped can easily
// contain none at all. Over-fetch, then trim to what was actually asked for.
//
// The engine caps `max` at 1000 and stops on its own wall clock, so a large
// ceiling here costs time on a selective band rather than hanging.
const RATING_OVERFETCH = 8;
const RATING_OVERFETCH_CAP = 500;

// The rating band, applied to what the extension handed back.
//
// The warehouse does this in SQL; the extension knows nothing about it and
// returns whatever Maps showed. Without this, choosing "4.5 and up" or "below
// 4.0" does nothing at all on any search that goes live — which is every custom
// keyword.
//
// Deliberately mirrors the SQL, including its edges: `>= min`, `< max`, and a
// business with no rating matches neither band, because `NULLIF(rating,'')`
// makes the comparison NULL rather than true.
function filterByRating(rows, minRating, maxRating) {
  if (minRating == null && maxRating == null) return rows;
  return (rows || []).filter((r) => {
    // Check for "no rating" before converting: Number("") and Number(null) are
    // both 0, which is finite, so an unrated business would otherwise sail
    // through "below 4.0" as a zero-star result.
    const raw = r?.rating;
    if (raw == null || raw === "") return false;
    const value = Number(raw);
    if (!Number.isFinite(value)) return false;
    if (minRating != null && value < minRating) return false;
    if (maxRating != null && value >= maxRating) return false;
    return true;
  });
}

// Great-circle distance in km. Plenty for "which city is closest" — the error
// against a proper geodesic is far smaller than a city is wide.
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nearest city *in the catalog*, not the nearest city on earth. The country and
// city dropdowns can only ever hold catalog entries, so resolving a location to
// anything outside it would leave the form displaying one place while searching
// another — the exact mismatch that makes a live search come back empty.
function nearestCatalogCity(countries, point) {
  let best = null;
  for (const country of countries || []) {
    for (const city of country.cities || []) {
      if (city.lat == null || city.lng == null) continue;
      const km = haversineKm(point, city);
      if (!best || km < best.km) best = { country, city, km };
    }
  }
  return best;
}

// Past this, "your location" and the city we'd search stop being the same
// place, so the map centres on the city rather than on the user.
const NEAR_CITY_KM = 150;

function buildQuickQuery(service, city, country) {
  return `${service} in ${city} ${country.querySuffix}`.replace(/\s+/g, " ").trim();
}

function quickProjectName(service, city) {
  const cleanCity = String(city || "").replace(/\s+[A-Z]{2}$/i, "");
  return `${cleanCity} ${service} Leads`.slice(0, 80);
}

// Build a project name from a free-typed query. Title-cases the query and tacks
// on a short id so repeat scrapes of the same query don't collide on one slug.
function projectNameFromQuery(query) {
  const clean = String(query || "").trim().replace(/\s+/g, " ");
  const titled = clean.replace(/\b\w/g, (c) => c.toUpperCase());
  const id = Date.now().toString(36).slice(-4);
  return `${titled || "Local"} Leads #${id}`.slice(0, 80);
}

// ── Matching what was typed against what we actually hold ──────────────────────
//
// The warehouse resolves a search from the service/city/country selects and never
// reads the search box, so any typed text used to be routed live on the grounds
// that it "might" be something we don't have. That threw away every instant
// answer: "plumber in Austin TX" is in the database, but typing it rather than
// picking it from the dropdowns forced a live scrape.
//
// These two functions read the same catalog the selects are built from, so typed
// text can be resolved to a real service + city — which is both what powers the
// suggestions under the box and what decides warehouse vs live.

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// How well `text` matches `name`: 3 exact, 2 prefix, 1 word-boundary substring,
// 0 no match. Ranking by this keeps "plumber" ahead of "commercial plumber".
function matchScore(text, name) {
  const t = norm(text);
  const n = norm(name);
  if (!t || !n) return 0;
  if (t === n) return 3;
  if (n.startsWith(t) || t.startsWith(n)) return 2;
  if (n.includes(t) || t.includes(n)) return 1;
  return 0;
}

// Flatten the catalog into the two lists the matcher needs. Cities carry their
// country so a hit can set all three selects at once.
function buildCatalogIndex(catalog) {
  const services = (catalog?.services || []).map((s) => ({ ...s }));
  const cities = [];
  for (const country of catalog?.countries || []) {
    for (const city of country.cities || []) {
      cities.push({ city, country, leadCount: Number(city.leadCount) || 0 });
    }
  }
  return { services, cities };
}

// Resolve free text to catalog entries. Splits on " in " when present — the same
// shape the geocoder and buildQuery use — and otherwise tries the whole string as
// a service and as a place. Returns ranked candidates; [] means we hold nothing
// matching, which is precisely the case that has to go live.
function matchCatalog(text, index, { limit = 6, preferCityId = null } = {}) {
  const raw = String(text || "").trim();
  if (raw.length < 2 || !index) return [];

  const split = raw.split(/(?:^|\s)in\s/i);
  const hasIn = split.length > 1;
  const keyword = hasIn ? split[0].trim() : raw;
  const place = hasIn ? split.slice(1).join(" in ").trim() : "";

  const scoredServices = index.services
    .map((s) => ({ s, score: matchScore(keyword, s.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.leadCount - a.s.leadCount);

  // With no place typed, the city the user already has selected wins — otherwise
  // typing a bare "plumber" would quietly move the search to whichever city we
  // happen to hold the most leads for, which is not what they asked for.
  const scoredCities = index.cities
    .map((c) => {
      if (!place) {
        const isSelected = preferCityId != null && String(c.city.id ?? c.city.name) === String(preferCityId);
        return { c, score: isSelected ? 3 : 1 };
      }
      const direct = matchScore(place, c.city.name);
      const withAdmin = c.city.admin ? matchScore(place, `${c.city.name} ${c.city.admin}`) : 0;
      const withCountry = matchScore(place, `${c.city.name} ${c.country.name}`);
      return { c, score: Math.max(direct, withAdmin, withCountry) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.c.leadCount - a.c.leadCount);

  if (!scoredServices.length || !scoredCities.length) return [];

  const out = [];
  for (const { s, score: sScore } of scoredServices.slice(0, 3)) {
    for (const { c, score: cScore } of scoredCities.slice(0, limit)) {
      out.push({
        service: s.name,
        serviceLeads: s.leadCount,
        city: c.city,
        country: c.country,
        leadCount: c.leadCount,
        // A place the user actually typed is worth more than one we defaulted to.
        score: sScore * 2 + cScore * (place ? 2 : 1),
      });
      if (out.length >= limit * 2) break;
    }
  }
  return out.sort((a, b) => b.score - a.score || b.leadCount - a.leadCount).slice(0, limit);
}

function Chip({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-card/40 text-muted-foreground hover:border-primary/50 hover:text-foreground"
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Live remaining-credits pill (reuses the /api/me poll behind useMe). Shown on the
// find-leads home and in the workspace header so the balance is always visible.
// Contact details behind the plan gate for free accounts.
//
// This is a *visual* gate: the value is still in the page for the account that
// scraped it, because a hard server-side gate would also have to cut CSV export
// and enrichment, which is a much larger change. It exists to prompt an upgrade,
// not to defend the data from its own owner.
function LockedContact({ value, className }) {
  return (
    <span className="inline-flex items-center gap-1.5" title="Upgrade your plan to reveal contact details">
      <span className={cn("select-none blur-[4px]", className)} aria-hidden="true">{value}</span>
      <Link
        href="/billing"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-primary/20"
      >
        Unlock
      </Link>
    </span>
  );
}

// Build a fallback catalog entry from the QUICK_ constants so the form still
// works when the catalog API is unreachable or returns nothing.
function buildFallbackCatalog() {
  return {
    countries: QUICK_COUNTRIES.map((c) => ({
      code: c.code,
      name: c.label,
      leadCount: 0,
      cities: c.cities.map((name) => ({ id: null, name, admin: "", lat: null, lng: null, leadCount: 0 })),
    })),
    services: QUICK_SERVICES.map((name) => ({ name, category: "", leadCount: 0 })),
  };
}

// Where this search gets its leads. Live search runs in the user's browser, so
// whether the extension is connected decides whether that option can work at
// all — the status sits right beside the control rather than being discovered
// after a search fails.
//
// This was two big description cards stacked above the rest of the form: a
// third of the first screen spent explaining a binary the user changes maybe
// once. A select does the same job in one row. The chip next to it shows the
// *effective* source, which is not a duplicate of the select — a typed query is
// always searched live whatever the preference says, and this is the only place
// that difference is visible before the search runs.
function SourcePicker({ source, setSource, ext, lockedLive }) {
  const active = lockedLive ? "live" : source;
  const ActiveIcon = active === "live" ? Zap : Database;

  return (
    <div data-tour="find-source">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <label className="w-44 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Lead source</span>
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-9"
            title="Our database answers instantly from leads we already hold. Live searches the map right now, in this browser."
          >
            <option value="warehouse">Our database</option>
            <option value="live">Live via extension</option>
          </Select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <ExtensionPill ext={ext} />
          <span
            title={
              lockedLive
                ? "Our database only covers the services in the dropdown, so what you typed is searched live in your browser."
                : active === "live"
                  ? "This search scrapes the map right now, in this browser."
                  : "This search is answered instantly from leads we already hold."
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
          >
            <ActiveIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium text-foreground">
              {active === "live" ? "Live via extension" : "Our database"}
            </span>
          </span>
        </div>
      </div>
      {active === "live" && !ext.checking && !ext.installed && (
        // This is a hard block, not advice: a live search cannot start without
        // the extension, so it gets stated plainly rather than as small print
        // beside the select.
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Puzzle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            No extension installed
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {lockedLive
              ? "Our database only covers the services in the dropdown, so what you typed has to be searched live, and live search runs inside your own browser."
              : "Live search runs inside your own browser, so it needs the LeadsFunda extension. Nothing here will run until it is installed."}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Link
              href="/extension"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              <Download className="h-3.5 w-3.5" />
              Install the extension
            </Link>
            {/* Pointless when the typed query is what forced live in the first
                place — switching the preference would not change the route. */}
            {!lockedLive && (
              <button
                type="button"
                onClick={() => setSource("warehouse")}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
              >
                Use our database instead
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Country + city pickers for a LIVE search, backed by the world list in
// data/geo (223 countries, 152,970 cities) rather than the warehouse catalog.
//
// The warehouse catalog only knows places we already hold leads for. That is the
// right list for a warehouse lookup and the wrong one for a live scrape, which
// can grid anywhere — so live mode used to hide these controls entirely rather
// than show a list that did not apply.
//
// The city control is a typed search, not a <select>: 152,970 options is ~10MB
// of DOM and would hang the browser.
//
// Picking a country loads that country's cities in ONE request; every keystroke
// after that filters the array in memory. Nothing waits on the network while
// typing. Worst case is the US at 16,731 cities — ~285KB gzipped, once — and
// most countries are under 70KB. The lists are cached for the session, so
// switching back to a country already visited is instant.
const LIVE_CITY_CACHE = new Map(); // country code -> city[]

// Same ranking the server uses: prefix matches ahead of mid-word ones, accents
// folded so "cordoba" finds "Córdoba". The source array is population-ordered,
// so ties resolve to the city people actually mean.
function filterCities(all, text, cap = 50) {
  const t = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!t) return all.slice(0, cap);
  const starts = [];
  const contains = [];
  for (const c of all) {
    const n = String(c.n).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (n.startsWith(t)) {
      if (starts.length < cap) starts.push(c);
      if (starts.length >= cap) break;
    } else if (contains.length < cap && n.includes(t)) {
      contains.push(c);
    }
  }
  return starts.concat(contains).slice(0, cap);
}

// Business-type picker for a LIVE search. ~3,968 Google Business Profile
// categories plus whatever the warehouse stocks (see /api/services), which is
// ~23KB gzipped — small enough to fetch once and filter in the browser.
//
// Free text is deliberately still accepted. A live scrape can search anything on
// the map, so the list is an aid, not a constraint: whatever is typed is what
// gets searched, whether or not it appears below.
let SERVICE_CACHE = null;

function LiveServicePicker({ value, onPick }) {
  const [services, setServices] = useState(() => SERVICE_CACHE || []);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (SERVICE_CACHE) return undefined;
    let alive = true;
    fetch(`${BASE_PATH}/api/services`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.services) return;
        SERVICE_CACHE = d.services;
        if (alive) setServices(d.services);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const results = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return services.slice(0, 50);
    const starts = [];
    const contains = [];
    for (const s of services) {
      const n = s.toLowerCase();
      if (n.startsWith(t)) { if (starts.length < 50) starts.push(s); }
      else if (contains.length < 50 && n.includes(t)) contains.push(s);
      if (starts.length >= 50) break;
    }
    return starts.concat(contains).slice(0, 50);
  }, [services, text]);

  return (
    <label className="relative space-y-1" data-tour="find-service">
      <span className="text-xs text-muted-foreground">Business type</span>
      <Input
        className="h-9"
        value={open ? text : value}
        placeholder="Any business type"
        autoComplete="off"
        onFocus={() => { setText(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        // Typing alone already changes the search — the list is a shortcut, not
        // a gate, so a category we don't list still works.
        onChange={(e) => { setText(e.target.value); onPick(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
          {results.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(s); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{s}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function LiveAreaPicker({ countryCode, onCountry, city, onCity, onCountryCities }) {
  const [countries, setCountries] = useState([]);
  const [text, setText] = useState("");
  const [cities, setCities] = useState(() => LIVE_CITY_CACHE.get(countryCode) || []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Countries are small (223) and never change; fetch once.
  useEffect(() => {
    let alive = true;
    fetch(`${BASE_PATH}/api/geo/places`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.countries) setCountries(d.countries); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // One fetch per country, on selection — not per keystroke.
  useEffect(() => {
    if (!countryCode) return undefined;
    const cached = LIVE_CITY_CACHE.get(countryCode);
    if (cached) { setCities(cached); setLoading(false); onCountryCities?.(cached); return undefined; }
    let alive = true;
    setLoading(true);
    setCities([]);
    fetch(`${BASE_PATH}/api/geo/places?country=${encodeURIComponent(countryCode)}&all=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.cities || [];
        LIVE_CITY_CACHE.set(countryCode, list);
        // Report them up so the map can move onto the country straight away,
        // before the user has picked any particular city.
        if (alive) { setCities(list); setLoading(false); onCountryCities?.(list); }
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryCode]);

  // Recomputed as they type, straight off the loaded array — no network, no
  // debounce, no waiting.
  const results = useMemo(() => filterCities(cities, text), [cities, text]);
  const label = city ? `${city.n}${city.s ? `, ${city.s}` : ""}` : "";

  return (
    <>
      <label className="space-y-1" data-tour="find-country">
        <span className="text-xs text-muted-foreground">Country</span>
        <Select
          className="h-9"
          value={countryCode}
          // Hand the name up too: the search box is geocoded as text, so the
          // parent needs "Australia", not "AU", to rewrite the query.
          onChange={(e) => {
            const code = e.target.value;
            onCountry(code, countries.find((x) => x.code === code)?.name || "");
            setText("");
          }}
        >
          {!countries.length && <option value={countryCode}>Loading…</option>}
          {countries.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </Select>
      </label>

      <label className="relative space-y-1" data-tour="find-city">
        <span className="text-xs text-muted-foreground">City</span>
        <Input
          className="h-9"
          value={open ? text : label}
          placeholder="Search any city"
          autoComplete="off"
          onFocus={() => { setText(""); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        />
        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
            {loading && !results.length ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading cities…</div>
            ) : results.length ? (
              results.map((c) => (
                <button
                  key={`${c.n}-${c.s}-${c.la}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // Hand the country's name up too — the parent only holds the
                    // code, and the query text needs the name.
                    onCity(c, countries.find((x) => x.code === countryCode)?.name || "");
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {c.n}
                    {c.s ? <span className="text-muted-foreground">{`, ${c.s}`}</span> : null}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">No city matches that</div>
            )}
          </div>
        )}
      </label>
    </>
  );
}

// Compact "is the extension connected?" indicator. Deliberately readable in both
// themes: a solid-coloured dot plus foreground-weight text, rather than tinted
// text on a tinted background.
function ExtensionPill({ ext }) {
  if (ext.checking) {
    return <span className="text-xs text-muted-foreground">Checking extension…</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs">
      <span className={cn("h-1.5 w-1.5 rounded-full", ext.installed ? "bg-emerald-500" : "bg-amber-500")} />
      <span className="font-medium text-foreground">
        {ext.installed ? `Extension connected` : "Extension not connected"}
      </span>
    </span>
  );
}

function QuickScrapeHome({ busy, onFind, onOpenDashboard, error, needPlan }) {
  // ── Catalog state ─────────────────────────────────────────────────────────
  const [catalog, setCatalog] = useState(null); // null = loading
  const [, setCatalogError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE_PATH}/api/catalog`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d && (d.countries?.length || d.services?.length)) {
          setCatalog(d);
        } else {
          setCatalogError(true);
          setCatalog(buildFallbackCatalog());
        }
      })
      .catch(() => {
        if (!alive) return;
        setCatalogError(true);
        setCatalog(buildFallbackCatalog());
      });
    return () => { alive = false; };
  }, []);

  // Resolved data: catalog when available, else fallback (shown while loading too)
  const resolved = catalog || buildFallbackCatalog();
  const catalogCountries = resolved.countries || [];
  const catalogServices = resolved.services || [];

  // ── Form state ─────────────────────────────────────────────────────────────
  // Start with stable static defaults to prevent double-switching on reload
  const [countryCode, setCountryCode] = useState(() => QUICK_COUNTRIES[0].code);
  const country = useMemo(
    () => catalogCountries.find((c) => c.code === countryCode) || catalogCountries[0] || { code: "", name: "", cities: [] },
    [catalogCountries, countryCode]
  );

  const [service, setService] = useState(() => QUICK_SERVICES[0]);
  // cityObj = { id, name, admin, lat, lng } from the catalog
  const [cityObj, setCityObj] = useState(() => {
    const fallbackCountry = QUICK_COUNTRIES[0];
    const defaultCityName = fallbackCountry.cities[10] || fallbackCountry.cities[0];
    return { id: null, name: defaultCityName, admin: "", lat: null, lng: null, leadCount: 0 };
  });
  const [citySearch, setCitySearch] = useState("");
  const [showChips, setShowChips] = useState(false);
  const [max, setMax] = useState("100");
  // One combined rating filter. "" = any, "gte:N" = N and up, "lt:N" = below N.
  // Mapped to the API's minRating/maxRating on submit so the backend is unchanged.
  const [rating, setRating] = useState("");
  const [allCities, setAllCities] = useState(false);
  // "Use my location" — GPS result, plus whatever we need to tell the user
  // about it. `geoNote` is {tone: "ok"|"warn", text}.
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNote, setGeoNote] = useState(null);
  const [radiusKm, setRadiusKm] = useState(10);
  // "warehouse" = serve what we already have (instant). "live" = scrape Google
  // Maps right now in this browser through the extension. Kept as an explicit
  // choice because a warehouse hit isn't necessarily the freshest answer.
  const [source, setSource] = useState("warehouse");
  // Whether the choice below is still ours to make. Once the user clicks either
  // card we stop moving it under them.
  const sourceTouched = useRef(false);
  const ext = useExtension();
  const [suggestOpen, setSuggestOpen] = useState(false);
  // Live-search area, chosen from the world list rather than the warehouse's.
  // Held separately from countryCode/cityObj so switching source back to the
  // warehouse does not find its selects pointing at a city we hold no leads for.
  const [liveCountry, setLiveCountry] = useState("US");
  // Whether the user has actually chosen a country, so the map is only recentred
  // on a real choice and not when the live panel first mounts with its default.
  const liveCountryPicked = useRef(false);
  const [liveCity, setLiveCity] = useState(null);
  const [liveService, setLiveService] = useState("");

  // With the extension installed, live search is the better default: it returns
  // what Google Maps holds right now rather than what we happen to have stored.
  // Detection is asynchronous, so this cannot be the initial state; it flips
  // once, only if the user has not already chosen.
  useEffect(() => {
    if (ext.checking || sourceTouched.current) return;
    if (ext.installed) setSource("live");
  }, [ext.checking, ext.installed]);

  function chooseSource(next) {
    sourceTouched.current = true;
    setSource(next);
  }
  // center for the area picker map — kept in sync with selected city
  const [center, setCenter] = useState(() =>
    cityObj?.lat != null && cityObj?.lng != null
      ? { lat: cityObj.lat, lng: cityObj.lng }
      : { lat: 30.2672, lng: -97.7431 } // Austin TX fallback
  );

  // Build query text from current selections (same shape as before)
  const buildQuery = (svc, cObj, cntry) => {
    const cityName = cObj?.name || "";
    const suffix = QUICK_COUNTRIES.find((q) => q.code === cntry?.code)?.querySuffix || cntry?.name || "";
    return `${svc} in ${cityName} ${suffix}`.replace(/\s+/g, " ").trim();
  };
  const [query, setQuery] = useState(() => buildQuery(service, cityObj, country));

  // What the dropdowns alone would search for. Anything the user types that
  // differs from this is a custom search.
  const autoQuery = useMemo(
    () => buildQuery(service, allCities ? null : cityObj, country),
    [service, allCities, cityObj, country]
  );

  // Recomputed as the user types. The warehouse resolves a search purely from the
  // dropdowns — service name, city id, country — and never reads this text. So
  // "Gujrat Plumber" with the city dropdown on Uppsala returns Uppsala plumbers:
  // a non-empty, confidently wrong answer. Typed text therefore cannot be handed
  // to the warehouse as-is; it has to be *resolved* to a real service + city
  // first, which is what `matches` below does.
  const queryIsCustom = useMemo(() => {
    const q = query.trim();
    return q !== "" && q !== autoQuery;
  }, [query, autoQuery]);

  // What we hold that looks like what was typed. Drives both the suggestion list
  // and the routing decision.
  const catalogIndex = useMemo(() => buildCatalogIndex(catalog), [catalog]);
  const matches = useMemo(
    () => (queryIsCustom ? matchCatalog(query, catalogIndex, { preferCityId: cityObj?.id ?? cityObj?.name ?? null }) : []),
    [queryIsCustom, query, catalogIndex, cityObj]
  );
  // The one we'd actually run. Only a confident hit counts: a stray substring
  // ("a" matching "salon") must not silently redirect a live search into a
  // warehouse lookup for somewhere else.
  const bestMatch = matches.length && matches[0].score >= 6 ? matches[0] : null;

  // Typed text we can serve from the database goes to the warehouse; anything we
  // don't hold still has to be scraped live. A query built by the dropdowns was
  // always warehouse-able, so it keeps honouring the user's own preference.
  const activeSource = !queryIsCustom ? source : bestMatch ? source : "live";
  const lockedLive = queryIsCustom && !bestMatch;

  // Settle the form on the catalog's biggest country, city and service once it
  // loads. This used to be a 12-tick slot-machine animation that flung random
  // countries and cities through the inputs for almost a second before landing
  // somewhere arbitrary. It looked busy, it made the form unusable while it ran,
  // and it left people searching a city they never chose.
  const settled = useRef(false);
  useEffect(() => {
    if (!catalog || settled.current) return;
    const countries = catalog.countries || [];
    const services = catalog.services || [];
    if (!countries.length || !services.length) return;
    settled.current = true;

    // The catalog is ordered by coverage, so the first entry is the one most
    // likely to return a full list.
    const topCountry = countries[0];
    const topCity = (topCountry.cities || [])[0] || null;
    const topService = services[0]?.name || service;

    setCountryCode(topCountry.code);
    if (topCity) {
      setCityObj(topCity);
      if (topCity.lat != null) setCenter({ lat: topCity.lat, lng: topCity.lng });
    }
    setService(topService);
    setQuery(buildQuery(topService, topCity, topCountry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const shownCities = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    return q
      ? (country.cities || []).filter((c) => (c.name || "").toLowerCase().includes(q))
      : (country.cities || []);
  }, [citySearch, country]);

  function changeCountry(nextCode) {
    const nextCountry = catalogCountries.find((c) => c.code === nextCode) || catalogCountries[0];
    if (!nextCountry) return;
    const nextCity = nextCountry.cities?.[0] || null;
    setCountryCode(nextCountry.code);
    setCityObj(nextCity);
    setCitySearch("");
    if (nextCity?.lat != null) setCenter({ lat: nextCity.lat, lng: nextCity.lng });
    setQuery(buildQuery(service, allCities ? null : nextCity, nextCountry));
  }

  function selectService(nextService) {
    setService(nextService);
    setQuery(buildQuery(nextService, allCities ? null : cityObj, country));
  }

  function selectCity(nextCityObj) {
    setAllCities(false);
    setCityObj(nextCityObj);
    if (nextCityObj?.lat != null && nextCityObj?.lng != null) {
      setCenter({ lat: nextCityObj.lat, lng: nextCityObj.lng });
    }
    setQuery(buildQuery(service, nextCityObj, country));
  }

  // Aim a live search at a city from the world list.
  //
  // Only the *place* changes. Someone who typed "24 hour emergency plumber" and
  // then picked Adelaide is moving that search, not asking to have their keyword
  // replaced by whatever the Service select happens to hold — so the keyword is
  // taken from what they typed, and only falls back to the select when the box
  // has no keyword of its own.
  // The search box is the single source of truth for a live search — the
  // extension geocodes exactly this text. The live pickers therefore edit one
  // half of it each and leave the other alone, rather than each rebuilding the
  // whole string from their own state and clobbering the other's choice.
  function splitQuery() {
    const parts = query.trim().split(/(?:^|\s)in\s/i);
    return {
      keyword: (parts[0] || "").trim(),
      place: parts.length > 1 ? parts.slice(1).join(" in ").trim() : "",
    };
  }

  function pickLiveService(s) {
    setLiveService(s);
    const { place } = splitQuery();
    const next = place ? `${s} in ${place}` : s;
    setQuery(next.replace(/\s+/g, " ").trim());
  }

  // Changing the country used to only swap the city list: the search box still
  // read "... in Adelaide, SA, Australia" (or the old country) and the map stayed
  // where it was, so the form disagreed with itself until a city was picked.
  // The country is a place choice, so it edits the place half of the query
  // immediately — same contract as pickLiveCity.
  function pickLiveCountry(code, countryName) {
    liveCountryPicked.current = true;
    setLiveCountry(code);
    setLiveCity(null);
    if (!countryName) return;
    const keyword = liveService || splitQuery().keyword || service;
    setQuery(`${keyword} in ${countryName}`.replace(/\s+/g, " ").trim());
  }

  // Move the map onto the new country as soon as its city list lands, using its
  // largest city as the stand-in centre. Only while no city is chosen — once the
  // user picks one, pickLiveCity owns the centre.
  function centerOnCountry(list) {
    // Only after an explicit country change — the picker also reports its list on
    // mount, and hijacking the map just for showing the panel would be wrong.
    if (!liveCountryPicked.current) return;
    if (liveCity || !Array.isArray(list) || !list.length) return;
    // /api/geo/places drops the population from the wire because the list is
    // already sorted by it, so the first city with coordinates IS the largest.
    const top = list.find((c) => Number.isFinite(c?.la) && Number.isFinite(c?.ln));
    if (top) setCenter({ lat: top.la, lng: top.ln });
  }

  function pickLiveCity(c, countryName) {
    setLiveCity(c);
    // Compact wire keys (n/s/la/ln) — see /api/geo/places.
    if (Number.isFinite(c?.la) && Number.isFinite(c?.ln)) {
      setCenter({ lat: c.la, lng: c.ln });
    }
    const keyword = liveService || splitQuery().keyword || service;
    // State disambiguates: "Austin" alone is four different places, and the
    // extension geocodes this text to decide where to grid.
    const place = [c.n, c.s, countryName].filter(Boolean).join(", ");
    setQuery(`${keyword} in ${place}`.replace(/\s+/g, " ").trim());
  }

  // Take a suggestion. This sets the three selects rather than only rewriting the
  // search box, because the selects are what the warehouse lookup actually reads
  // — rewriting the text alone would show the right thing and search the old one.
  // With them set, the query matches `autoQuery`, so the search stops counting as
  // custom and routes to the database on its own.
  function applyMatch(m) {
    setSuggestOpen(false);
    setAllCities(false);
    setCitySearch("");
    setService(m.service);
    setCountryCode(m.country.code);
    setCityObj(m.city);
    if (m.city.lat != null && m.city.lng != null) {
      setCenter({ lat: m.city.lat, lng: m.city.lng });
    }
    setQuery(buildQuery(m.service, m.city, m.country));
    chooseSource("warehouse");
  }

  // "All cities" searches the whole country (no city/radius filter).
  function selectAllCities() {
    setAllCities(true);
    setQuery(buildQuery(service, null, country));
  }

  // Ask the browser where we are and put that place in the search box.
  //
  // The name comes from a reverse geocode, not from the city dropdown. Matching
  // to the nearest warehouse city would only ever name somewhere we already
  // hold leads — Pakistan has three such cities, so standing in Islamabad would
  // fill in "Gujrat District", 135km away. A real name is both correct and
  // searchable, because a place we don't cover simply routes to live search.
  //
  // If the place does happen to be a city we cover, the dropdowns move onto it
  // as well, so the search can be served instantly from the warehouse.
  //
  // Requires HTTPS, which production is.
  function locateMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoNote({ tone: "warn", text: "This browser can't share a location." });
      return;
    }
    setGeoBusy(true);
    setGeoNote(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        // Only the *place* changes. Someone who typed "24 hour emergency
        // plumber" is asking to move that search, not to have it quietly
        // swapped back to whatever the Service dropdown happens to hold. The
        // resolver already isolates the keyword for us; the split is the
        // fallback for before it has answered.
        const typed = query.trim();
        const keyword =
          (queryIsCustom &&
            (resolvedArea?.keyword ||
              typed.split(/(?:^|\s+)in\s+/i)[0].trim())) ||
          service;

        let named = null;
        try {
          const r = await fetch(
            `${BASE_PATH}/api/geo/reverse?lat=${point.lat}&lng=${point.lng}`
          );
          const d = r.ok ? await r.json() : null;
          if (d?.resolved && d.place) named = d;
        } catch {
          // Offline or Nominatim down — fall through to the catalog match.
        }

        setGeoBusy(false);
        setCenter(point);
        setAllCities(false);
        setCitySearch("");

        // Does the warehouse actually have this place? Same country, same name.
        const match = named
          ? (catalogCountries || [])
              .filter((c) => !named.countryCode || c.code === named.countryCode)
              .flatMap((c) => (c.cities || []).map((city) => ({ c, city })))
              .find(
                ({ city }) =>
                  city.name.toLowerCase() === named.place.toLowerCase()
              )
          : null;

        if (match) {
          setCountryCode(match.c.code);
          setCityObj(match.city);
          setQuery(buildQuery(keyword, match.city, match.c));
          setGeoNote({
            tone: "ok",
            text: `You're in ${named.place}${
              named.countryName ? `, ${named.countryName}` : ""
            }, we already have leads there.`,
          });
          return;
        }

        if (named) {
          // Not a city we cover. Leave the dropdowns alone and let the typed
          // query drive it: a custom query already routes to live search, which
          // is exactly the path a place we don't hold leads for needs.
          setQuery(
            `${keyword} in ${named.place} ${named.countryName || ""}`
              .replace(/\s+/g, " ")
              .trim()
          );
          setGeoNote({
            tone: "ok",
            text: `You're in ${named.place}${
              named.countryName ? `, ${named.countryName}` : ""
            }. We have no leads stored there yet, so this runs as a live search.`,
          });
          return;
        }

        // Reverse geocoding failed. Nearest covered city is a weaker answer,
        // but it beats leaving the form pointing at wherever it was.
        const best = nearestCatalogCity(catalogCountries, point);
        if (!best) {
          setGeoNote({
            tone: "warn",
            text: "Got your location, but couldn't work out the place name. Pick a city from the dropdown.",
          });
          return;
        }
        setCountryCode(best.country.code);
        setCityObj(best.city);
        setQuery(buildQuery(keyword, best.city, best.country));
        if (best.km > NEAR_CITY_KM) {
          setCenter({ lat: best.city.lat, lng: best.city.lng });
        }
        setGeoNote({
          tone: "warn",
          text: `Couldn't name your exact location. Using ${best.city.name}, the closest city we cover (about ${Math.round(
            best.km
          )} km away).`,
        });
      },
      (err) => {
        setGeoBusy(false);
        setGeoNote({
          tone: "warn",
          text:
            err?.code === 1
              ? "Location access was blocked. Allow it from the icon in your address bar, then try again."
              : "Couldn't get your location. Pick a city from the dropdown instead.",
        });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  // ── Where a typed search actually goes ────────────────────────────────────
  // The map used to follow the city dropdown and nothing else, so typing
  // "plumbers in islamabad" left the pin on whichever city the select happened
  // to hold. The map then showed one place while the search ran in another,
  // which is what made a custom keyword look like it landed on a random city.
  //
  // The same resolver the server uses is asked here, so the preview and the
  // search cannot disagree. The pin moves to the resolved place and the radius
  // slider keeps working, because the search is sent as resolved-centre plus
  // the user's radius rather than as the geocoder's own bounding box.
  const [resolvedArea, setResolvedArea] = useState(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    // A query we can already answer from our own catalog needs no geocoder: we
    // know the city, and asking Nominatim would only add latency and a second
    // opinion that can disagree with the city we're about to query.
    if (!queryIsCustom || bestMatch) {
      setResolvedArea(null);
      setResolving(false);
      return undefined;
    }
    const text = query.trim();
    if (text.length < 3) return undefined;

    let alive = true;
    setResolving(true);
    // Debounced: this hits Nominatim, and firing per keystroke would be both
    // useless and a good way to get the app rate limited.
    const timer = setTimeout(() => {
      fetch(`${BASE_PATH}/api/geo/resolve?q=${encodeURIComponent(text)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          setResolvedArea(d?.resolved ? d : null);
          setResolving(false);
        })
        .catch(() => {
          if (alive) setResolving(false);
        });
    }, 700);

    return () => {
      alive = false;
      clearTimeout(timer);
      setResolving(false);
    };
  }, [queryIsCustom, query, bestMatch]);

  // Move the pin onto the resolved place. Deliberately not the other way round:
  // dragging the pin afterwards still works, because this only fires when the
  // geocoder returns somewhere new.
  useEffect(() => {
    if (resolvedArea?.lat != null && resolvedArea?.lng != null) {
      setCenter({ lat: resolvedArea.lat, lng: resolvedArea.lng });
    }
  }, [resolvedArea]);

  // Same, for a match out of our own catalog. This is not cosmetic: centre and
  // radius are sent as filters on the warehouse query too, so leaving the pin on
  // the previous city would filter "plumber in Austin" by a circle drawn around
  // somewhere else and return nothing.
  const matchKey = bestMatch ? `${bestMatch.service}|${bestMatch.city.id ?? bestMatch.city.name}` : "";
  useEffect(() => {
    if (!bestMatch) return;
    const { lat, lng } = bestMatch.city;
    if (lat != null && lng != null) setCenter({ lat, lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey]);

  function submit(e) {
    e.preventDefault();
    // A typed query we can serve is run against the matched service + city, not
    // against whatever the selects happen to show. Sending the selects would
    // answer confidently for the wrong place — the exact failure that made every
    // typed search go live in the first place.
    const useMatch = queryIsCustom && bestMatch && source !== "live" ? bestMatch : null;
    const matchService = useMatch ? useMatch.service : service;
    const matchCity = useMatch ? useMatch.city : allCities ? null : cityObj;
    const matchCountry = useMatch ? useMatch.country : country;

    const cleanQuery = query.trim() || buildQuery(matchService, matchCity, matchCountry);
    const effectiveCity = useMatch ? matchCity : allCities ? null : cityObj;
    const isCustom = !useMatch && cleanQuery !== buildQuery(service, effectiveCity, country);
    const isUnknownKeyword = !useMatch && !catalogServices.some(s =>
      cleanQuery.toLowerCase().includes(s.name.toLowerCase())
    );
    // Only text we could not resolve has to be scraped live; a resolved match is
    // a warehouse lookup like any dropdown-built search.
    const effectiveSource = useMatch ? source : isCustom || isUnknownKeyword ? "live" : source;
    const cityLabel = useMatch
      ? matchCity?.name || ""
      : allCities ? (country.name || "All cities") : cityObj?.name || "";

    let name;
    if (isUnknownKeyword) {
      const cityPart = allCities ? "" : (cityObj?.name ? `${cityObj.name}, ` : "");
      const countryPart = country?.name || "";
      const baseName = `Leads in ${cityPart}${countryPart}`.trim();
      const id = Date.now().toString(36).slice(-4);
      name = `${baseName} #${id}`;
    } else {
      name = useMatch
        ? quickProjectName(matchService, cityLabel)
        : isCustom ? projectNameFromQuery(cleanQuery) : quickProjectName(service, cityLabel);
    }

    onFind({
      name,
      query: cleanQuery,
      cityId: useMatch ? matchCity?.id ?? null : allCities ? null : cityObj?.id || null,
      cityName: useMatch ? matchCity?.name || "" : allCities ? "" : cityObj?.name || "",
      countryCode: (useMatch ? matchCountry.code : country.code) || "",
      countryName: (useMatch ? matchCountry.name : country.name) || "",
      service: matchService,
      isUnknownKeyword,
      isCustomQuery: isCustom,
      minRating: rating.startsWith("gte:") ? Number(rating.slice(4)) : undefined,
      maxRating: rating.startsWith("lt:") ? Number(rating.slice(3)) : undefined,
      // A live scrape grids a bounding box, so it always needs a centre — "All
      // cities" would otherwise hand the extension undefined coords and produce
      // nothing. The warehouse path keeps its country-wide behaviour.
      centerLat: allCities && effectiveSource !== "live" ? undefined : center.lat,
      centerLng: allCities && effectiveSource !== "live" ? undefined : center.lng,
      radiusKm: allCities && effectiveSource !== "live" ? undefined : Number(radiusKm) || 10,
      // A typed search that resolved to a real place searches THAT place, at the
      // radius on the slider. Without this the server geocodes the text again
      // and grids the geocoder's own bounding box, which ignores the radius
      // entirely: a 5 km search of "restaurants in London" would quietly cover
      // all of Greater London.
      // Only meaningful for a live scrape — a warehouse lookup is already
      // pinned to the matched city id, and handing it a geocoder result would
      // just be a second, weaker opinion about where to search.
      resolvedArea:
        effectiveSource === "live" && queryIsCustom && resolvedArea?.lat != null
          ? {
              place: resolvedArea.place,
              display: resolvedArea.display,
              countryCode: resolvedArea.countryCode,
              countryName: resolvedArea.countryName,
              keyword: resolvedArea.keyword,
              lat: resolvedArea.lat,
              lng: resolvedArea.lng,
            }
          : undefined,
      max: String(Math.min(10000, Math.max(1, Math.trunc(Number(max) || 100)))),
      source: effectiveSource,
    });
  }

  // The chip browser uses the same city objects from the catalog
  const chipCityLabel = (c) => `${c.name}${c.admin ? ", " + c.admin : ""}`;
  // For the select dropdown value we use city id (or name as fallback)
  const citySelectVal = allCities ? "__all__" : cityObj?.id ?? cityObj?.name ?? "";

  return (
    // The column is capped and centred. Full-bleed stretched a six-control form
    // and a single search box across the whole monitor, which left the eye
    // travelling the width of the screen between a label and its field.
    <div className="animate-page-in motion-reduce:animate-none mx-auto w-full max-w-4xl px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      {/* The projects link lives in the topbar on desktop (see `findActions`
          below). The topbar has no room for it on a phone, so it rides here
          instead — and only there, because on desktop this row would push the
          heading off the sidebar's baseline. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 md:hidden">
        <div className="flex flex-wrap items-center gap-2" />
        <button
          type="button"
          onClick={onOpenDashboard}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          View my projects <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* pt-4 above + a locked 36px line box puts this heading on exactly the
          same band as "New search", the sidebar's first nav item: same 16px off
          the header border, same height, so the two columns start on one line.
          Changing the size here means re-checking that leading. */}
      <h1 className="text-center text-2xl font-bold leading-9 tracking-tight sm:text-3xl sm:leading-9">
        What leads do you want to find?
      </h1>

      {error && (
        <div className={cn(
          "mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
          needPlan ? "border-primary/40 bg-primary/10 text-foreground" : "border-destructive/40 bg-destructive/10 text-red-600"
        )}>
          <span>{error}</span>
          {needPlan && (
            <Button asChild size="sm">
              <Link href="/billing"><CreditCard size={15} /> Choose a plan</Link>
            </Button>
          )}
        </div>
      )}

      {/* The magnifier lives on the button, not inside the box. Having it in
          both places said the same thing twice and cost the query 40px of the
          only field on the page anyone actually types into. */}
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSuggestOpen(true); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
            onKeyDown={(e) => { if (e.key === "Escape") setSuggestOpen(false); }}
            placeholder="plumber in Austin TX"
            className="h-10 w-full text-sm"
            autoComplete="off"
            autoFocus
          />
          {/* What we already hold that looks like what's being typed. Picking one
              fills the selects, so the search runs instantly out of the database
              instead of scraping a city we already have. */}
          {suggestOpen && matches.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              <li className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Ready in our database
              </li>
              {matches.map((m) => (
                <li key={`${m.service}-${m.city.id ?? m.city.name}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyMatch(m)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <Database className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        <span className="font-medium capitalize">{m.service}</span>
                        {" in "}
                        <span className="font-medium">{m.city.name}</span>
                        {m.city.admin ? `, ${m.city.admin}` : ""}
                        <span className="text-muted-foreground">{` · ${m.country.name}`}</span>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                      {m.leadCount.toLocaleString()} leads
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="submit" className="h-10 shrink-0 px-5" disabled={!!busy || !query.trim()} data-tour="find-submit">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find leads
        </Button>
      </form>

      {/* Says which way this search will actually go, before it runs. Silent for
          a dropdown-built query, where nothing surprising is happening. */}
      {queryIsCustom && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {bestMatch && activeSource !== "live" ? (
            <>
              <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
              We already have <span className="font-semibold text-foreground">{bestMatch.leadCount.toLocaleString()}</span>
              {" "}<span className="capitalize">{bestMatch.service}</span> leads in{" "}
              <span className="font-semibold text-foreground">{bestMatch.city.name}</span>, which runs instantly from our database.
            </>
          ) : bestMatch ? (
            // Matched, but the user asked for live anyway. Say so rather than
            // claiming a database hit the search is not going to use.
            <>
              <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
              We hold <span className="font-semibold text-foreground">{bestMatch.leadCount.toLocaleString()}</span> of these in{" "}
              <span className="font-semibold text-foreground">{bestMatch.city.name}</span>, but Lead source is set to live, so this will scrape fresh results.
            </>
          ) : (
            <>
              <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              Nothing matching in our database, so this one is scraped live in your browser.
            </>
          )}
        </p>
      )}

      {/* Everything that shapes the search in one card: source, the warehouse
          dropdowns, size, rating, radius. They were four separately bordered
          blocks with their own outer margins, which spread six short rows of
          controls down most of a screen. */}
      <div className="mt-4 space-y-3 rounded-xl border border-border bg-card/40 p-4">
        <SourcePicker
          source={source}
          setSource={chooseSource}
          ext={ext}
          lockedLive={lockedLive}
        />

        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
          {/* Service, Country and City resolve a warehouse lookup. A live search
              does not use any of them: the extension geocodes whatever is in the
              search box and grids that area, so leaving them on screen showed three
              controls that had no effect on the search about to run. */}
          {activeSource !== "live" && (
            <>
              <label className="space-y-1" data-tour="find-service">
                <span className="text-xs text-muted-foreground">Service</span>
                <Select value={service} onChange={(e) => selectService(e.target.value)} className="h-9 capitalize">
                  {catalogServices.map((item) => (
                    <option key={item.name} value={item.name}>{titleCase(item.name)}</option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1" data-tour="find-country">
                <span className="text-xs text-muted-foreground">Country</span>
                <Select value={countryCode} onChange={(e) => changeCountry(e.target.value)} className="h-9">
                  {catalogCountries.map((item) => (
                    <option key={item.code} value={item.code}>{item.name}</option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1" data-tour="find-city">
                <span className="text-xs text-muted-foreground">City</span>
                <Select
                  className="h-9"
                  value={citySelectVal}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__all__") { selectAllCities(); return; }
                    const found = (country.cities || []).find((c) => String(c.id ?? c.name) === val);
                    if (found) selectCity(found);
                  }}
                >
                  <option value="__all__">All cities</option>
                  {(country.cities || []).map((c) => (
                    <option key={c.id ?? c.name} value={c.id ?? c.name}>{c.name}{c.admin ? `, ${c.admin}` : ""}</option>
                  ))}
                </Select>
              </label>
            </>
          )}

          {/* A live scrape can grid anywhere, so it gets the world list instead
              of the warehouse's coverage. These used to be hidden entirely for
              live, which meant the only way to aim one was to type the place. */}
          {activeSource === "live" && (
            <>
              <LiveServicePicker value={liveService} onPick={pickLiveService} />
              <LiveAreaPicker
                countryCode={liveCountry}
                onCountry={pickLiveCountry}
                city={liveCity}
                onCity={pickLiveCity}
                onCountryCities={centerOnCountry}
              />
            </>
          )}

          {/* Always relevant, whichever source is running. */}
          <label className="space-y-1" data-tour="find-max">
            <span className="text-xs text-muted-foreground">Leads (max 10,000)</span>
            <Input className="h-9" type="number" min={1} max={10000} value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
          <label className="space-y-1" data-tour="find-rating">
            <span className="text-xs text-muted-foreground">Rating</span>
            <Select className="h-9" value={rating} onChange={(e) => setRating(e.target.value)} title="Target high-rated businesses or low-rated ones that need help">
              <option value="">Any rating</option>
              <option value="gte:4.5">4.5 and up</option>
              <option value="gte:4">4.0 and up</option>
              <option value="gte:3.5">3.5 and up</option>
              <option value="gte:3">3.0 and up</option>
              <option value="lt:4">Below 4.0</option>
              <option value="lt:3.5">Below 3.5</option>
              <option value="lt:3">Below 3.0</option>
            </Select>
          </label>
        </div>

        {/* Radius used to be a bare slider squeezed into a quarter of a four
            column grid, with its value tucked into the label. It decides how much
            ground a search covers, so it gets a full row, a readable value and
            presets for the distances people actually pick. */}
        <div data-tour="find-radius">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              Search radius
            </span>
            <span className="rounded-lg bg-muted px-2.5 py-0.5 text-sm font-semibold tabular-nums text-foreground">
              {allCities ? "Country-wide" : `${radiusKm} km`}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={200}
            value={radiusKm}
            disabled={allCities}
            onChange={(e) => setRadiusKm(Number(e.target.value) || 1)}
            style={{ "--slider-percentage": `${((radiusKm - 1) / 199) * 100}%` }}
            className="mt-1.5 h-5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {[5, 10, 25, 50, 100].map((km) => (
              <button
                key={km}
                type="button"
                disabled={allCities}
                onClick={() => setRadiusKm(km)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  Number(radiusKm) === km
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {km} km
              </button>
            ))}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {allCities
                ? "Every city in the country"
                : `Covers about ${Math.round(Math.PI * radiusKm * radiusKm).toLocaleString()} km²`}
            </span>
          </div>
        </div>
      </div>

      {/* Area picker map. On a wide screen it sits beside the controls instead of
          under them — the page is full-width now, and stacking a short form on top
          of a short map left most of the screen empty. */}
      <div className="mt-3" data-tour="find-map">
        {/* What a typed search resolved to. Without this the map silently
            disagrees with the search box and the user has no way to tell
            which one the search will follow. Suppressed for a query we matched
            in our own catalog: that one already says where it is going, above. */}
        {queryIsCustom && !bestMatch && (
          <div className="mb-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
            {resolving ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Working out where to search
              </span>
            ) : resolvedArea ? (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                Searching
                <span className="font-semibold text-foreground">
                  {resolvedArea.keyword || service}
                </span>
                within {radiusKm} km of
                <span className="font-semibold text-foreground">
                  {resolvedArea.place}
                </span>
                {resolvedArea.countryName ? `, ${resolvedArea.countryName}` : ""}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                No place recognised in what you typed, so the search will use{" "}
                <span className="font-semibold">{cityObj?.name || country?.name}</span>
              </span>
            )}
          </div>
        )}
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span>Drag the pin to refine the search center</span>
          </div>
          <button
            type="button"
            onClick={locateMe}
            disabled={geoBusy}
            title="Set the search area to where you are right now"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {geoBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LocateFixed className="h-3.5 w-3.5" />
            )}
            {geoBusy ? "Locating…" : "Use my location"}
          </button>
        </div>
        {geoNote && (
          <p
            className={cn(
              "mb-1.5 text-xs",
              geoNote.tone === "warn" ? "text-amber-600" : "text-muted-foreground"
            )}
          >
            {geoNote.text}
          </p>
        )}
        {/* Taller beside the controls than it was stacked under them — in the
            side-by-side layout it has the height to spare, and the radius circle
            is easier to judge at this size. */}
        <LeadsMap
          interactive
          center={center}
          radiusKm={Number(radiusKm) || 10}
          onCenterChange={setCenter}
          height={210}
        />
      </div>

      {/* Dropdowns are the default; the chip browser below is an optional, collapsed view. */}
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => setShowChips((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {showChips ? "Hide chip browser" : "Browse popular services & cities"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showChips && "rotate-180")} />
        </button>
      </div>

      {showChips && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[260px_1fr]">
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Service</h2>
              <div className="flex flex-wrap gap-1.5">
                {catalogServices.map((item) => (
                  <Chip key={item.name} active={service === item.name} onClick={() => selectService(item.name)}>{item.name}</Chip>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {catalogCountries.map((item) => (
                  <Chip key={item.code} active={countryCode === item.code} onClick={() => changeCountry(item.code)}>{item.code}</Chip>
                ))}
              </div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{country.name}</h2>
                <Input
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Find city"
                  className="h-8 w-40"
                />
              </div>
              <div className="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto">
                {shownCities.map((c) => (
                  <Chip
                    key={c.id ?? c.name}
                    active={cityObj?.id != null ? cityObj.id === c.id : cityObj?.name === c.name}
                    onClick={() => selectCity(c)}
                  >
                    {chipCityLabel(c)}
                  </Chip>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// A bare number over a caption told you how many rows existed but not whether
// that was good. The icon tile makes the row scannable at a glance, and `hint`
// carries the number that actually matters: how much of the project each stage
// has covered so far.
// One cell of the KPI strip. Deliberately not a card: four cards meant four
// borders, four shadows and four sets of padding to say four numbers, which is
// most of a screenful spent before the first lead. Here the strip is one
// bordered row and the cells are divided by a hairline.
//
// The number leads, the label sits under it, and the third line is context for
// the number rather than a second metric — coverage as a percentage, or the
// band behind a score. Anything more and the strip starts competing with the
// table for attention.
function Kpi({ value, text, label, icon: Icon, hint, tone = "" }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-3 py-2.5 sm:px-4">
      {Icon && <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground/70" />}
      <div className="min-w-0">
        <div className={cn("text-[21px] font-semibold leading-none tracking-tight tabular-nums", tone)}>
          {text ?? <AnimatedNumber value={value} />}
        </div>
        <div className="mt-1 truncate text-[11px] font-medium text-muted-foreground">{label}</div>
        {hint ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{hint}</div> : null}
      </div>
    </div>
  );
}

export default function Dashboard({ view = "" }) {
  const router = useRouter();

  // A label built from the dropdowns is only trustworthy when the search itself
  // came from the dropdowns. For a typed query it described somewhere the
  // search never went — a project of Islamabad businesses titled "Copenhagen,
  // Denmark Leads". Prefer the stored name, which the server now derives from
  // the place it actually resolved and searched.
  const getProjectDisplayName = (p) => {
    if (!p) return "";
    if (p.name) return p.name;
    const cityPart = p.cityName ? `${p.cityName}, ` : "";
    return `${cityPart}${p.countryName || ""} Leads`;
  };

  // This field is labelled "Maps query", so it has to be the query. Showing a
  // dropdown-derived stand-in instead is how a search for "islamabad" came to
  // read "Copenhagen, Denmark Leads". Fall back to the stand-in only when
  // there is genuinely no query to show.
  const getProjectDisplayQuery = (p) => {
    if (!p) return "";
    if (p.query) return p.query;
    const cityPart = p.cityName ? `${p.cityName}, ` : "";
    return cityPart || p.countryName ? `${cityPart}${p.countryName || ""} Leads` : "";
  };

  // Header crumb line: "Plumber · Sydney NSW · Australia". Reads better than the
  // raw query string and matches how the search was actually specified. Falls
  // back to the query when a project has no structured place on it (typed
  // searches, older projects).
  const getProjectCrumbs = (p, leadSample) => {
    if (!p) return "";
    const service = leadSample?.category || "";
    const parts = [
      service,
      p.cityName || leadSample?.city,
      p.countryName || leadSample?.country,
    ].filter(Boolean);
    return parts.length >= 2 ? parts.join(" · ") : getProjectDisplayQuery(p);
  };

  // The find-leads home vs. the projects workspace is driven by the URL (?view=projects),
  // so the logo, "New search", and the "Projects" nav item can all navigate to it.
  const simpleMode = view !== "projects";
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [needPlan, setNeedPlan] = useState(false);
  const [isTransitioningOut, setIsTransitioningOut] = useState(false);
  const [findResult, setFindResult] = useState(null); // dismissible "grabbed N leads" alert
  // Live search runs in the browser extension; this drives the "install it"
  // prompt and the in-progress readout while it scrapes.
  const [needExtension, setNeedExtension] = useState(false);
  // Progress of a live scrape running in the extension (null = no overlay).
  const [scrapeProgress, setScrapeProgress] = useState(null);
  // Lets the Stop button reach into a run that's already in flight. Held in a ref
  // rather than state because aborting must not depend on a re-render landing.
  const scrapeAbortRef = useRef(null);

  // Clear the toast once a scrape finishes cleanly. Errors stay up until
  // dismissed — a failed browser-side scrape leaves no server job to go and read.
  useEffect(() => {
    if (scrapeProgress?.status !== "done") return;
    const t = setTimeout(() => setScrapeProgress(null), 6000);
    return () => clearTimeout(t);
  }, [scrapeProgress]);
  const [hideSyncBanner, setHideSyncBanner] = useState(false); // dismiss the dbSync banner
  const [tablePage, setTablePage] = useState(0); // captured-leads table pagination
  // Workspace table controls. Filters narrow the captured rows, search matches
  // across name/phone/email/address, and sort defaults to opportunity so the
  // leads worth calling are the ones you see first.
  const [leadSearch, setLeadSearch] = useState("");
  const [leadSort, setLeadSort] = useState("opportunity");
  const [leadFilters, setLeadFilters] = useState({
    website: "all", email: "all", phone: "all", reviews: "all",
    rating: "all", social: "all", enriched: "all",
  });
  const [moreFilters, setMoreFilters] = useState(false);
  // The lead open in the right-hand detail drawer (a row click inspects; the
  // checkbox is what selects for bulk actions).
  const [detailKey, setDetailKey] = useState(null);
  // The row as it looked when it was clicked. Keeps the drawer populated if that
  // lead later drops out of the visible `leads` array (filter, page, refresh).
  const [detailSnapshot, setDetailSnapshot] = useState(null);
  // Open the drawer for a row, remembering the row itself and not just its key.
  const openLeadDetail = (lead, key) => {
    setDetailSnapshot(lead);
    setDetailKey(key);
  };
  const closeLeadDetail = () => {
    setDetailKey(null);
    setDetailSnapshot(null);
  };
  // Which view of this project's leads is showing: the table or the map. The map
  // is a tab rather than a permanently docked panel, so Leaflet and its tiles are
  // never fetched until somebody asks for them. Remembered per browser, because
  // someone who works from the map keeps working from the map.
  const [workspaceTab, setWorkspaceTab] = useState("leads");
  useEffect(() => {
    try {
      if (localStorage.getItem("lf_ws_tab") === "map") setWorkspaceTab("map");
    } catch {}
  }, []);
  // Per-row state for the captured-leads table actions (enrich / whatsapp / report
  // / remove). The leads list itself is rebuilt from project status on every poll,
  // so action results and removals are kept in an overlay keyed by a stable lead
  // key and merged back on top of the polled rows.
  const [rowBusy, setRowBusy] = useState({});
  const [rowOverlay, setRowOverlay] = useState({});
  // How many projects the sidebar shows; "Load more" reveals 10 at a time so a
  // big account doesn't render hundreds of rows on every poll.
  const [projectLimit, setProjectLimit] = useState(10);
  const [visibleChipCount, setVisibleChipCount] = useState(5);
  // Captured lead currently open in the shared "Add to list" dialog (saved to the
  // DB first so it has an id). Mirrors the Leads manager for a consistent flow.
  const [listsLead, setListsLead] = useState(null);
  // Bulk selection on the captured-leads table — keyed by the stable leadKey
  // (captured rows have no DB id yet), so a click tracks the same lead across the
  // 1.5s status polls. Mirrors the Leads manager: row-click toggles, header all.
  const [selectedLeads, setSelectedLeads] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState("");
  // Progress for a realtime (queue-free) enrich/whatsapp batch: { kind, done, total }.
  const [realtimeBatch, setRealtimeBatch] = useState(null);
  const [credits, setCredits] = useState(null);
  // Full plan entitlement ({ active, remaining, plan, credits }) used to pre-check
  // searches before hitting the server. remaining === null means unlimited.
  const [entitlement, setEntitlement] = useState(null);
  // Free = loaded entitlement with no active plan. Null means "not answered
  // yet", and locking on that would flash the paywall at paying customers.
  const contactLocked = entitlement != null && !entitlement.active;
  // Per-day usage ({ searches, leads, resetAt, tz }) to pre-check the daily caps.
  const [daily, setDaily] = useState(null);
  // Captured rows being added to a list in bulk — saved to the DB first so they
  // have ids; { ids, keys } drives the shared dialog + the "listed" overlay.
  const [listsBulk, setListsBulk] = useState(null);
  // Live progress for an in-flight bulk batch (reports OR audits — shared card).
  const [batch, setBatch] = useState(null);
  const batchPollRef = useRef(null);
  // id→leadKey map for the running batch so audit scores can be overlaid back onto
  // the captured rows when the jobs finish.
  const batchKeyMap = useRef({});
  // Tiny self-dismissing toast for quick confirmations (e.g. favoriting a project).
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }
  // Favorite stars the user just toggled, keyed by slug → desired value. The 1.5s
  // poll replaces the whole projects array, which used to revert an optimistic
  // star before the PATCH had persisted. We hold the user's intent here and keep
  // overriding the polled value until the backend reports the same thing.
  const pendingWatch = useRef(new Map());

  const selectedProject = useMemo(() => projects.find((p) => p.slug === selected), [projects, selected]);

  // Async status fetches can land after you've already switched projects. We read
  // the live selection from a ref so a stale response (for a project you've left)
  // is dropped instead of clobbering the panel with the wrong project's data.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Is the project named in the form already running? Drives the run buttons so
  // you can launch a NEW project while another is still scraping (run many at once).
  const formSlug = useMemo(() => slugify(form.name), [form.name]);
  const formRunning = useMemo(() => !!projects.find((p) => p.slug === formSlug)?.running, [projects, formSlug]);

  async function loadProjects() {
    const data = await jsonFetch("/api/projects");
    const list = (data.projects || []).map((p) => {
      if (pendingWatch.current.has(p.slug)) {
        const want = pendingWatch.current.get(p.slug);
        if (p.watchlist === want) pendingWatch.current.delete(p.slug); // backend caught up
        else return { ...p, watchlist: want }; // keep the user's intent until it does
      }
      return p;
    });
    setProjects(list);
    if (!selected && list[0]) setSelected(list[0].slug);
  }

  // syncForm is only true when the user switches projects — NOT during the 1.5s
  // status poll. Otherwise each poll would overwrite whatever you're typing into
  // the name/query/leads boxes and "restore" the previous text mid-keystroke.
  async function loadStatus(slug = selected, syncForm = false) {
    if (!slug) return;
    try {
      const data = await jsonFetch(`/api/projects/${encodeURIComponent(slug)}/status`);
      if (slug !== selectedRef.current) return; // switched away mid-flight — drop it
      setStatus(data);
      if (syncForm) {
        setForm((old) => ({ ...old, name: data.name || old.name, query: data.query || old.query, max: data.max || old.max }));
      }
    } catch {
      if (slug === selectedRef.current) setStatus(null);
    }
  }

  useEffect(() => {
    if (simpleMode) return;
    loadProjects().catch((err) => setError(err.message));
  }, [simpleMode]);

  useEffect(() => {
    if (simpleMode) {
      setIsTransitioningOut(false);
    }
  }, [simpleMode]);

  useEffect(() => {
    if (simpleMode) return;
    // Reset the panel immediately so switching projects always visibly changes the
    // view, even before the new status lands.
    setStatus(null);
    let cancelled = false;
    let timer;

    loadStatus(selected, true).catch(() => {}); // switching project: populate the form once

    // Self-scheduling poll: the next tick is only queued AFTER the current one
    // settles, so a slow server (e.g. audits running) can never stack up dozens of
    // overlapping requests — which was the cause of the lag/glitching.
    const tick = async () => {
      if (cancelled) return;
      await Promise.allSettled([loadProjects(), loadStatus(selected, false)]);
      if (!cancelled) timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected, simpleMode]);

  // Reset table pagination when switching projects.
  useEffect(() => { setTablePage(0); }, [selected]);

  // Keep a live credit balance for the bulk audit/report cost warnings, and stop
  // the batch poller if the page unmounts mid-run.
  useEffect(() => {
    let alive = true;
    jsonFetch("/api/me").then((d) => { if (alive) { setCredits(d?.entitlement?.credits ?? null); setEntitlement(d?.entitlement ?? null); setDaily(d?.daily ?? null); } }).catch(() => {});
    return () => { alive = false; clearTimeout(batchPollRef.current); };
  }, []);
  function refreshCredits() {
    jsonFetch("/api/me").then((d) => { setCredits(d?.entitlement?.credits ?? null); setEntitlement(d?.entitlement ?? null); setDaily(d?.daily ?? null); }).catch(() => {});
  }

  // "Xh Ym" until the daily counters reset, for the exhaustion banner.
  function resetCountdown(resetAt) {
    if (!resetAt) return "tonight";
    const ms = new Date(resetAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return "soon";
    const mins = Math.floor(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
  }

  // Pre-flight plan/quota gate for searches: matches the server checks in
  // /api/projects/find + /run so the user gets instant feedback instead of a
  // doomed request. Skips when entitlement hasn't loaded (the server still gates).
  function ensureCanSearch() {
    const ent = entitlement;
    if (!ent) return true;
    if (!ent.unlimited && (ent.credits || 0) <= 0) {
      setNeedPlan(true);
      setError(SHOW_CREDITS
        ? "You're out of credits. Choose a plan or top up to find more leads."
        : "You've used up your plan's allowance. Choose a plan to keep finding leads.");
      return false;
    }
    // Per-day caps (server is authoritative; this is just instant feedback).
    if (daily) {
      const s = daily.searches, l = daily.leads;
      const when = `${resetCountdown(daily.resetAt)} (at midnight ${daily.tz})`;
      if (s && !s.unlimited && s.remaining <= 0) {
        setNeedPlan(true);
        setError(`You've used all ${s.limit} of today's searches. Your limit resets in ${when}.`);
        return false;
      }
      if (l && !l.unlimited && l.remaining <= 0) {
        setNeedPlan(true);
        setError(`You've reached today's ${l.limit.toLocaleString()} lead limit. It resets in ${when}.`);
        return false;
      }
    }
    return true;
  }

  async function run(stages, formOverride = form) {
    const runForm = formOverride || form;
    // A scrape pulls new leads → costs plan quota; gate it before we start.
    if (stages.includes("scrape") && !ensureCanSearch()) return false;
    setBusy(`Starting ${stages.join(", ")}`);
    setError("");
    setNeedPlan(false);
    try {
      const data = await jsonFetch("/api/projects/run", {
        method: "POST",
        body: JSON.stringify({
          ...runForm,
          stages,
          enrichConcurrency: Number(runForm.enrichConcurrency || 16),
          auditConcurrency: Number(runForm.auditConcurrency || 2),
        }),
      });
      setSelected(data.slug);
      await loadProjects();
      await loadStatus(data.slug);
      return true;
    } catch (err) {
      setError(err.message);
      if (["no_plan", "quota_exceeded", "no_credits", "daily_search_limit", "daily_lead_limit"].includes(err.code)) setNeedPlan(true);
      if (["daily_search_limit", "daily_lead_limit"].includes(err.code)) refreshCredits();
      return false;
    } finally {
      setBusy("");
    }
  }

  async function startQuickScrape(nextForm) {
    setForm(nextForm);
    // Only drop into the workspace once a project actually started — on a billing
    // error we stay on the find-leads home so the plan prompt is right there.
    const ok = await run(["scrape"], nextForm);
    if (ok) {
      setIsTransitioningOut(true);
      setTimeout(() => {
        router.push("/dashboard?view=projects");
      }, 300);
    }
  }

  // Drive the extension through a live scrape, then hand the rows to the
  // server to store. Progress is surfaced through the same `busy` label the
  // rest of the page uses, so this doesn't need its own UI.
  async function runExtensionScrape(slug, liveParams) {
    const wantMax = Math.max(1, Number(liveParams.max) || 30);
    const hasRatingFilter =
      liveParams.minRating != null || liveParams.maxRating != null;
    // Scan deeper when a band is set, because most of what comes back will be
    // thrown away. Without a band this stays exactly as it was.
    const scrapeMax = hasRatingFilter
      ? Math.min(wantMax * RATING_OVERFETCH, RATING_OVERFETCH_CAP)
      : liveParams.max;

    setBusy("Searching the map in your browser");
    const startedAt = Date.now();
    const controller = new AbortController();
    scrapeAbortRef.current = controller;
    setScrapeProgress({
      status: "running",
      phase: "search",
      done: 0,
      total: 0,
      startedAt,
      found: null,
      foundSeq: 0,
      message: "Starting…",
    });

    try {
      const { rows: scraped, cancelled, timedOut } = await scrapeWithExtension(
        {
          query: liveParams.query,
          service: liveParams.service,
          // A geocoded bbox (from typed text) takes priority in the engine over
          // centre+radius; both are forwarded so the fallback still works.
          bbox: liveParams.bbox,
          latStep: liveParams.latStep,
          lngStep: liveParams.lngStep,
          centerLat: liveParams.centerLat,
          centerLng: liveParams.centerLng,
          radiusKm: liveParams.radiusKm,
          max: scrapeMax,
          // Search only. Crawling each site for emails and socials now runs on
          // the server after /ingest, so the user isn't kept waiting behind the
          // slowest business website in the area with the tab pinned open.
          enrich: false,
        },
        {
          signal: controller.signal,
          onProgress: ({ done, total, scanned, scanTotal, found }) => {
            setBusy(total ? `Searching the map (${done}/${total})` : "Searching the map");
            setScrapeProgress((prev) => ({
              ...(prev || {}),
              status: "running",
              phase: "search",
              done: done || 0,
              total: total || 0,
              scanned: scanned || 0,
              scanTotal: scanTotal || 0,
              startedAt,
              // Businesses arrive in bursts of ~20 — one map tile resolving —
              // so only the newest burst is handed over, tagged with a counter.
              // The overlay owns the queue and the pacing, which is what lets it
              // reveal them one at a time instead of flashing twenty at once.
              found: found?.length ? found : null,
              foundSeq: (prev?.foundSeq || 0) + (found?.length ? 1 : 0),
              message: `${done} business${done === 1 ? "" : "es"} found`,
            }));
          },
        }
      );

      // Drop the ones outside the chosen rating band before anything counts,
      // saves or displays them, so the numbers on screen are the numbers stored.
      // Then trim the over-fetch back to the size the user actually asked for.
      const matched = filterByRating(
        scraped,
        liveParams.minRating,
        liveParams.maxRating
      );
      const rows = hasRatingFilter ? matched.slice(0, wantMax) : matched;
      const droppedByRating = scraped.length - matched.length;

      setBusy(`Saving ${rows.length} leads`);
      setScrapeProgress((prev) => ({
        ...(prev || {}),
        status: "running",
        phase: "save",
        done: rows.length,
        total: rows.length,
        stopped: !!cancelled,
        timedOut: !!timedOut,
        message: `Saving ${rows.length} leads…`,
      }));

      const saved = await jsonFetch(`/api/projects/${encodeURIComponent(slug)}/ingest`, {
        method: "POST",
        body: JSON.stringify({ rows }),
      });

      const stored = saved.stored ?? rows.length;
      setScrapeProgress({
        // A clean run that found nothing is not a success to flash for 6
        // seconds — it's the case the user most needs to read, so it stays up
        // and says what to change.
        status: stored ? "done" : "empty",
        phase: "save",
        done: stored,
        total: stored,
        stopped: !!cancelled,
        timedOut: !!timedOut,
        // How the server picked up the second half of the job, so the overlay
        // can say emails are still coming rather than implying the run is over.
        enrich: saved.enrich || null,
        fromCache: saved.fromCache || 0,
        message: stored
          ? // Coming back with fewer than asked for is normal on a tight band,
            // and looks like a bug unless the numbers behind it are shown.
            hasRatingFilter && stored < wantMax
            ? `${stored} leads saved. ${scraped.length} businesses were scanned and ${matched.length} matched the rating filter.`
            : `${stored} leads saved to this project.`
          : // Blaming the keyword when the rating filter is what emptied the
            // results sends the user off widening an area that was never the
            // problem. Say which one it was.
            droppedByRating
            ? `Found ${scraped.length} business${
                scraped.length === 1 ? "" : "es"
              }, but none matched the rating filter. Widen it or set it to "Any rating".`
            : `Nothing found for "${liveParams.query}"${
                liveParams.areaLabel ? ` around ${liveParams.areaLabel.split(",")[0]}` : ""
              }. Try a broader keyword or a wider area.`,
      });

      return {
        total: stored,
        inserted: saved.inserted ?? 0,
        updated: saved.updated ?? 0,
      };
    } catch (err) {
      // Leave the overlay up on failure — this is the only place the user finds
      // out a browser-side scrape died, since there's no server job to inspect.
      setScrapeProgress((prev) => ({
        ...(prev || {}),
        status: "error",
        phase: "search",
        message: err?.message || "The extension stopped responding.",
      }));
      throw err;
    } finally {
      scrapeAbortRef.current = null;
    }
  }

  // Ask the extension to stop. The run still resolves normally, with whatever it
  // had found — a stopped search keeps its leads, it doesn't discard them.
  function stopExtensionScrape() {
    scrapeAbortRef.current?.abort();
    setScrapeProgress((prev) =>
      prev ? { ...prev, stopping: true, message: "Stopping, saving what we found…" } : prev
    );
  }

  // POST to /api/projects/find (warehouse-backed instant delivery).
  // Same plan/quota error handling as run(); same navigation on success.
  async function startFindLeads(findParams) {
    // Check for the extension BEFORE calling /find: that endpoint counts the
    // search against the daily cap up front, so bouncing off a missing
    // extension afterwards would silently burn one for nothing.
    if (findParams.source === "live" && !(await detectExtension())) {
      setNeedExtension(true);
      return;
    }
    if (!ensureCanSearch()) return;
    setBusy("Finding leads");
    setError("");
    setNeedPlan(false);
    try {
      const data = await jsonFetch("/api/projects/find", {
        method: "POST",
        body: JSON.stringify({
          name: findParams.name,
          query: findParams.query,
          cityId: findParams.cityId,
          cityName: findParams.cityName,
          countryCode: findParams.countryCode,
          countryName: findParams.countryName,
          service: findParams.service,
          isUnknownKeyword: findParams.isUnknownKeyword,
          isCustomQuery: findParams.isCustomQuery,
          minRating: findParams.minRating,
          maxRating: findParams.maxRating,
          centerLat: findParams.centerLat,
          centerLng: findParams.centerLng,
          radiusKm: findParams.radiusKm,
          max: findParams.max,
          source: findParams.source,
          // Where the form resolved a typed search to. Lets the server search
          // that place at the chosen radius instead of re-geocoding the text
          // and gridding the whole administrative area.
          resolvedArea: findParams.resolvedArea,
        }),
      });
      setSelected(data.slug);
      setHideSyncBanner(false);

      // The warehouse had nothing for this area, so the leads have to be
      // scraped live — which happens in the user's browser via the extension,
      // not on our server.
      let result = { total: data.total ?? 0, inserted: data.inserted ?? 0, updated: data.updated ?? 0 };
      const wentLive = !!data.needsLive;
      if (wentLive) {
        const version = await detectExtension();
        if (!version) {
          setNeedExtension(true);
          setBusy("");
          return;
        }
        result = await runExtensionScrape(data.slug, data.liveParams || findParams);
      }

      // Two panels used to stack up here: the live-search overlay finishes on
      // "N leads saved to this project" and then this alert opened on top of it
      // saying much the same thing, so the redirect landed on two popups. The
      // overlay is the report for an extension run; this alert is the report
      // for a warehouse run. Only ever one of them.
      if (!wentLive) setFindResult(result);
      refreshCredits();
      await loadProjects();
      await loadStatus(data.slug);

      // Smooth page transition out
      setIsTransitioningOut(true);
      setTimeout(() => {
        router.push("/dashboard?view=projects");
      }, 300);
    } catch (err) {
      setError(err.message);
      if (["no_plan", "quota_exceeded", "no_credits", "daily_search_limit", "daily_lead_limit"].includes(err.code)) setNeedPlan(true);
      if (["daily_search_limit", "daily_lead_limit"].includes(err.code)) refreshCredits();
    } finally {
      setBusy("");
    }
  }

  async function projectAction(action, method = "POST") {
    if (!selected) return;
    if (action === "delete" && !confirm(`Delete "${status?.name || selectedProject?.name || selected}"? This removes the project files from disk.`)) return;
    setBusy(action);
    setError("");
    try {
      if (action === "delete") {
        await jsonFetch(`/api/projects/${encodeURIComponent(selected)}`, { method: "DELETE" });
      } else {
        await jsonFetch(`/api/projects/${encodeURIComponent(selected)}/${action}`, { method });
      }
      await loadProjects();
      if (action === "delete") {
        setSelected("");
        setStatus(null);
      } else {
        await loadStatus();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  // Stop every running project at once — kills their runner trees plus any
  // Lighthouse/Chrome/scrape processes still churning in the background.
  async function stopAllProjects() {
    setBusy("stop all");
    setError("");
    try {
      await jsonFetch("/api/projects/stop-all", { method: "POST" });
      await loadProjects();
      if (selected) await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function toggleProjectWatch(project) {
    const item = project || selectedProject;
    if (!item?.slug) return;
    const next = !item.watchlist;
    setError("");
    // Record the intent so the next poll can't revert the star before the PATCH
    // persists, flip it immediately, and confirm with a toast.
    pendingWatch.current.set(item.slug, next);
    setProjects((ps) => ps.map((p) => (p.slug === item.slug ? { ...p, watchlist: next } : p)));
    showToast(next ? `★ Added “${item.name}” to favorites` : `Removed “${item.name}” from favorites`);
    try {
      await jsonFetch(`/api/projects/${encodeURIComponent(item.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ watchlist: next }),
      });
    } catch (err) {
      // Only revert if the save itself failed.
      pendingWatch.current.delete(item.slug);
      setProjects((ps) => ps.map((p) => (p.slug === item.slug ? { ...p, watchlist: item.watchlist } : p)));
      setError(err.message);
      showToast("Couldn't update favorite, try again");
      return;
    }
    // Best-effort refresh; don't revert the star if this part hiccups.
    try {
      await loadProjects();
      if (item.slug === selected) await loadStatus(item.slug);
    } catch {}
  }

  async function addCapturedLead(lead, target) {
    const notes =
      target === "contact_list"
        ? prompt("Notes for this custom list item", lead.notes || "")
        : "";
    if (notes === null) return;
    // Captured rows have no saved favorite/list state, so light the icon up via the
    // row overlay immediately and confirm with a toast — the POST is a slow round-trip
    // and waiting for it felt like nothing happened. Revert the flag if the save fails.
    const key = leadKey(lead);
    const flag = target === "watchlist" ? "__favorited" : "__listed";
    setRowOverlay((o) => ({ ...o, [key]: { ...(o[key] || {}), [flag]: true } }));
    showToast(
      target === "watchlist"
        ? `★ Added “${lead.name || "lead"}” to favorites`
        : `Added “${lead.name || "lead"}” to your list`
    );
    setError("");
    try {
      await jsonFetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          name: lead.name,
          category: lead.category,
          rating: lead.rating,
          reviews: lead.reviews,
          website: lead.website,
          phone: lead.phone,
          address: lead.address,
          maps_url: lead.mapsUrl || lead.maps_url,
          email: lead.email,
          all_emails: lead.allEmails || lead.all_emails,
          facebook: lead.facebook,
          instagram: lead.instagram,
          linkedin: lead.linkedin,
          twitter: lead.twitter,
          youtube: lead.youtube,
          tiktok: lead.tiktok,
          pinterest: lead.pinterest,
          whatsapp: lead.whatsapp,
          telegram: lead.telegram,
          project: status?.name || selectedProject?.name || form.name,
          query: status?.query || form.query,
          watchlist: target === "watchlist",
          contact_list: target === "contact_list",
          notes,
        }),
      });
    } catch (err) {
      setRowOverlay((o) => ({ ...o, [key]: { ...(o[key] || {}), [flag]: false } }));
      setError(err.message);
      showToast("Couldn't add, try again");
    }
  }

  // Stable identity for a captured (CSV) lead, matching the DB dedupe rule:
  // domain, else phone digits, else name. Used to key per-row state + overlay.
  function leadKey(lead) {
    const host = (lead.domain || "").toLowerCase() ||
      (lead.website || "").replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0].toLowerCase();
    if (host) return "d:" + host;
    const phone = String(lead.phone || "").replace(/\D/g, "");
    if (phone.length >= 7) return "p:" + phone;
    return "n:" + String(lead.name || "").trim().toLowerCase();
  }

  const setRowBusyKey = (key, action, val) =>
    setRowBusy((b) => ({ ...b, [key]: { ...(b[key] || {}), [action]: val } }));

  // Captured leads aren't necessarily in the global DB yet (or lack an id here),
  // so ensure the lead exists and return its DB id before running an action.
  async function ensureLeadId(lead) {
    const data = await jsonFetch("/api/leads", {
      method: "POST",
      body: JSON.stringify({
        name: lead.name,
        category: lead.category,
        rating: lead.rating,
        reviews: lead.reviews,
        website: lead.website,
        phone: lead.phone,
        address: lead.address,
        maps_url: lead.mapsUrl || lead.maps_url,
        email: lead.email,
        all_emails: lead.allEmails || lead.all_emails,
        facebook: lead.facebook,
        instagram: lead.instagram,
        linkedin: lead.linkedin,
        twitter: lead.twitter,
        youtube: lead.youtube,
        tiktok: lead.tiktok,
        pinterest: lead.pinterest,
        whatsapp: lead.whatsapp,
        telegram: lead.telegram,
        project: status?.name || selectedProject?.name || form.name,
        query: status?.query || form.query,
      }),
    });
    if (!data.lead?.id) throw new Error("Could not save this lead first");
    return data.lead;
  }

  async function enrichCaptured(lead) {
    const key = leadKey(lead);
    setRowBusyKey(key, "enrich", true);
    setError("");
    try {
      const saved = await ensureLeadId(lead);
      const data = await jsonFetch(`/api/leads/${saved.id}/enrich`, { method: "POST" });
      const l = data.lead || {};
      setRowOverlay((o) => ({
        ...o,
        [key]: {
          ...(o[key] || {}),
          email: l.email, allEmails: l.all_emails, enrichStatus: l.enrich_status,
          facebook: l.facebook, instagram: l.instagram, linkedin: l.linkedin,
          twitter: l.twitter, youtube: l.youtube, tiktok: l.tiktok,
          pinterest: l.pinterest, whatsapp: l.whatsapp, telegram: l.telegram,
        },
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRowBusyKey(key, "enrich", false);
    }
  }

  async function whatsappCaptured(lead) {
    const key = leadKey(lead);
    setRowBusyKey(key, "whatsapp", true);
    setError("");
    try {
      const saved = await ensureLeadId(lead);
      const data = await jsonFetch(`/api/leads/${saved.id}/whatsapp`, { method: "POST" });
      const s = String(data.lead?.whatsapp_status || "").toLowerCase();
      const exists = s.startsWith("on whatsapp") || s === "yes" ? "yes" : s.startsWith("not on whatsapp") || s === "no" ? "no" : "";
      setRowOverlay((o) => ({ ...o, [key]: { ...(o[key] || {}), whatsappExists: exists, whatsappId: data.lead?.whatsapp_id } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRowBusyKey(key, "whatsapp", false);
    }
  }

  // Save the captured row, then open the shared "Add to list" dialog for it — the
  // same flow the Leads manager uses (replaces the old prompt()).
  async function openListsForCaptured(lead) {
    const key = leadKey(lead);
    setRowBusyKey(key, "list", true);
    setError("");
    try {
      const saved = await ensureLeadId(lead);
      setListsLead({ id: saved.id, name: saved.name || lead.name, domain: saved.domain || lead.domain, website: saved.website || lead.website, __key: key });
    } catch (err) {
      setError(err.message);
    } finally {
      setRowBusyKey(key, "list", false);
    }
  }

  // Download what's on screen as CSV. Exports the selection when there is one,
  // otherwise the current filtered view — so "Export" always means "the leads I
  // am looking at". The opportunity score and its top reason ride along, since
  // that ordering is the reason to pull the list in the first place.
  function exportLeadsCsv() {
    const rows = selectedCount > 0 ? selectedLeadObjs : leads;
    if (!rows.length) return;
    const columns = [
      ["Name", (l) => l.name],
      ["Category", (l) => l.category],
      ["Phone", (l) => l.phone],
      ["Email", (l) => l.email],
      ["Website", (l) => l.website],
      ["Address", (l) => l.address],
      ["Rating", (l) => l.rating],
      ["Reviews", (l) => l.reviews],
      ["Facebook", (l) => l.facebook],
      ["Instagram", (l) => l.instagram],
      ["LinkedIn", (l) => l.linkedin],
      ["Marketing stack", (l) => trackingDetect.summarize(trackingDetect.parse(l.tech))],
      ["Opportunity", (l) => scoreLead(l).score],
      ["Opportunity band", (l) => BAND_LABEL[scoreLead(l).band]],
      ["Top reason", (l) => scoreLead(l).reasons[0] || ""],
      ["Maps URL", (l) => l.mapsUrl || l.maps_url],
    ];
    const escape = (v) => {
      const text = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [
      columns.map(([label]) => escape(label)).join(","),
      ...rows.map((l) => columns.map(([, read]) => escape(read(l))).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(getProjectDisplayName(selectedProject) || "leads").replace(/[^\w.-]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length.toLocaleString()} lead${rows.length === 1 ? "" : "s"}`);
  }

  // Remove from this captured list only (local hide) — it stays in the global
  // leads database, matching the rule that the overall view owns deletion.
  function hideCaptured(lead) {
    const key = leadKey(lead);
    setRowOverlay((o) => ({ ...o, [key]: { ...(o[key] || {}), __removed: true } }));
  }

  const stages = status?.state?.stages || {};
  const allLeads = (status?.leads || [])
    .map((l) => ({ ...l, ...(rowOverlay[leadKey(l)] || {}) }))
    .filter((l) => !l.__removed);

  // "any"/"none" plus per-network has/hasn't. Named networks matter because
  // "no Facebook page" and "no LinkedIn" are different pitches to different
  // businesses, and a single has-socials toggle could not express either.
  function matchSocialFilter(lead, mode) {
    if (mode === "all") return true;
    const any = !!(lead.facebook || lead.instagram || lead.linkedin || lead.twitter || lead.tiktok || lead.youtube);
    if (mode === "any") return any;
    if (mode === "none") return !any;
    const network = mode.replace(/^no-/, "");
    const has = !!lead[network];
    return mode.startsWith("no-") ? !has : has;
  }

  // Live counts shown next to each dropdown option, so you can see how many
  // leads a filter would leave before committing to it. Counted against the
  // OTHER active filters, which is what makes the numbers add up to what you
  // actually get.
  const filterCounts = useMemo(() => {
    const base = (status?.leads || [])
      .map((l) => ({ ...l, ...(rowOverlay[leadKey(l)] || {}) }))
      .filter((l) => !l.__removed);
    const yesNo = (mode, has) => mode === "all" || (mode === "yes" ? has : !has);
    const matchesExcept = (l, skip) =>
      (skip === "website" || yesNo(leadFilters.website, !!l.website)) &&
      (skip === "email" || yesNo(leadFilters.email, !!l.email)) &&
      (skip === "phone" || yesNo(leadFilters.phone, !!l.phone)) &&
      (skip === "reviews" || leadFilters.reviews === "all" || (() => {
        const n = reviewCount(l);
        if (leadFilters.reviews === "none") return n === 0;
        if (leadFilters.reviews === "some") return n >= 1 && n <= 20;
        return n > 20;
      })()) &&
      (skip === "social" || matchSocialFilter(l, leadFilters.social)) &&
      (skip === "enriched" || leadFilters.enriched === "all" ||
        (leadFilters.enriched === "yes") === !!(l.enrichStatus || l.enrich_status || l.email));

    const count = (skip, predicate) => base.filter((l) => matchesExcept(l, skip) && predicate(l)).length;
    const ratingOf = (l) => parseFloat(l.rating);
    return {
      website: { all: count("website", () => true), yes: count("website", (l) => !!l.website), no: count("website", (l) => !l.website) },
      email: { all: count("email", () => true), yes: count("email", (l) => !!l.email), no: count("email", (l) => !l.email) },
      phone: { all: count("phone", () => true), yes: count("phone", (l) => !!l.phone), no: count("phone", (l) => !l.phone) },
      reviews: {
        all: count("reviews", () => true),
        none: count("reviews", (l) => reviewCount(l) === 0),
        some: count("reviews", (l) => reviewCount(l) >= 1 && reviewCount(l) <= 20),
        many: count("reviews", (l) => reviewCount(l) > 20),
      },
      rating: {
        all: base.length,
        none: base.filter((l) => !Number.isFinite(ratingOf(l))).length,
        low: base.filter((l) => ratingOf(l) < 4).length,
        good: base.filter((l) => ratingOf(l) >= 4 && ratingOf(l) < 4.5).length,
        top: base.filter((l) => ratingOf(l) >= 4.5).length,
      },
      enriched: {
        all: count("enriched", () => true),
        yes: count("enriched", (l) => !!(l.enrichStatus || l.enrich_status || l.email)),
        no: count("enriched", (l) => !(l.enrichStatus || l.enrich_status || l.email)),
      },
      social: Object.fromEntries(
        ["all", "any", "none", "facebook", "instagram", "linkedin", "no-facebook", "no-instagram", "no-linkedin"].map(
          (mode) => [mode, count("social", (l) => matchSocialFilter(l, mode))]
        )
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.leads, rowOverlay, leadFilters]);

  // Filter -> search -> sort, then paginate. Kept as one pass over the captured
  // rows; `leads` below is what every count, selection and export works from, so
  // a filtered view acts on exactly the rows you can see.
  const leads = useMemo(() => {
    const yesNo = (mode, has) => mode === "all" || (mode === "yes" ? has : !has);
    const q = leadSearch.trim().toLowerCase();
    let rows = allLeads.filter((l) => {
      if (!yesNo(leadFilters.website, !!l.website)) return false;
      if (!yesNo(leadFilters.email, !!l.email)) return false;
      if (!yesNo(leadFilters.phone, !!l.phone)) return false;
      if (leadFilters.reviews !== "all") {
        const n = reviewCount(l);
        if (leadFilters.reviews === "none" && n !== 0) return false;
        if (leadFilters.reviews === "some" && (n < 1 || n > 20)) return false;
        if (leadFilters.reviews === "many" && n <= 20) return false;
      }
      if (leadFilters.rating !== "all") {
        const r = parseFloat(l.rating);
        if (leadFilters.rating === "none" && Number.isFinite(r)) return false;
        if (leadFilters.rating === "low" && !(Number.isFinite(r) && r < 4)) return false;
        if (leadFilters.rating === "good" && !(Number.isFinite(r) && r >= 4 && r < 4.5)) return false;
        if (leadFilters.rating === "top" && !(Number.isFinite(r) && r >= 4.5)) return false;
      }
      if (!matchSocialFilter(l, leadFilters.social)) return false;
      if (!yesNo(leadFilters.enriched, !!(l.enrichStatus || l.enrich_status || l.email))) return false;
      if (q) {
        const hay = [l.name, l.phone, l.email, l.address, l.website, l.category].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (leadSort === "opportunity") {
      rows = rows.map((l) => [l, scoreLead(l).score]).sort((a, b) => b[1] - a[1]).map(([l]) => l);
    } else if (leadSort === "name") {
      rows = [...rows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    } else if (leadSort === "reviews") {
      rows = [...rows].sort((a, b) => reviewCount(b) - reviewCount(a));
    } else if (leadSort === "rating") {
      rows = [...rows].sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
    }
    // "found" (default scrape order) needs no sort — that's the incoming order.
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.leads, rowOverlay, leadFilters, leadSearch, leadSort]);

  const filtersActive =
    !!leadSearch.trim() || Object.values(leadFilters).some((v) => v !== "all");

  // Paginate at 50/page — enough to scan, small enough that the drawer and the
  // row actions stay responsive on a 300-lead find.
  const tablePageCount = Math.max(1, Math.ceil(leads.length / WORKSPACE_PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, tablePageCount - 1);
  const pagedLeads = leads.slice(safeTablePage * WORKSPACE_PAGE_SIZE, safeTablePage * WORKSPACE_PAGE_SIZE + WORKSPACE_PAGE_SIZE);
  const pageOffset = safeTablePage * WORKSPACE_PAGE_SIZE;
  // Prefer the live row (so an enrich mid-drawer updates in place), but fall back
  // to the snapshot taken on click. `leads` is re-derived by filtering, paging,
  // polling and live-search ticks, so the clicked row can vanish from it while the
  // drawer is still open — which used to leave the panel rendering nothing at all.
  const detailLead = detailKey
    ? leads.find((l) => leadKey(l) === detailKey) || detailSnapshot || null
    : null;
  // Trust either source: the projects list (authoritative, refreshed every tick)
  // or the selected project's status. This keeps the Stop button enabled even
  // when a status fetch is mid-flight or briefly stale after switching projects.
  const running = !!status?.state?.activeAlive || !!selectedProject?.running;
  const runningCount = projects.filter((p) => p.running).length;
  // A project is genuinely waiting in the queue only when it's flagged queued, isn't
  // running, and hasn't already produced a result. A stale `queued:true` left on a
  // finished/failed/stopped project (the runner doesn't always reset it) must NOT
  // keep showing "waiting for a free slot" — especially for instant warehouse finds.
  const isQueued =
    !!status?.state?.queued &&
    !running &&
    !status?.state?.finishedAt &&
    status?.state?.stages?.scrape?.status !== "done" &&
    !/^(Done|Failed|Stopped|Leads loaded)/i.test(status?.state?.message || "");
  // How many captured leads have a website — drives the project toolbar
  // Audit/Report buttons (which now run the same bulk flow as the leads page).
  const leadsWithSite = leads.filter((l) => l.website).length;
  // Live "Queued for Ns" timer: while a project sits queued nothing rewrites its
  // state, so updatedAt stays at enqueue time and this grows on each 1.5s poll.
  const queuedFor =
    isQueued && status?.state?.updatedAt
      ? Math.max(0, Math.round((Date.now() - Date.parse(status.state.updatedAt)) / 1000))
      : 0;

  // --- Bulk selection over the captured-leads table (keyed by leadKey) ---
  const leadKeysOnPage = pagedLeads.map(leadKey);
  const selectedLeadObjs = leads.filter((l) => selectedLeads.has(leadKey(l)));
  const selectedCount = selectedLeadObjs.length;
  const allLeadsSelected = leadKeysOnPage.length > 0 && leadKeysOnPage.every((k) => selectedLeads.has(k));
  const toggleLead = (key) => setSelectedLeads((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAllLeads = () => setSelectedLeads((s) => {
    const n = new Set(s);
    if (leadKeysOnPage.every((k) => n.has(k))) leadKeysOnPage.forEach((k) => n.delete(k));
    else leadKeysOnPage.forEach((k) => n.add(k));
    return n;
  });

  // Ensure every selected captured lead exists in the DB; returns [{ key, id }].
  // Used by bulk audit / report / add-to-list (the bulk endpoints work off ids).
  // Saves the whole selection in ONE request (ids come back aligned to input
  // order) instead of a slow POST per lead — selecting 30 rows used to take 30+s.
  async function ensureSelectedIds(leadObjs) {
    if (!leadObjs.length) return [];
    const payload = leadObjs.map((lead) => ({
      name: lead.name, category: lead.category, rating: lead.rating, reviews: lead.reviews,
      website: lead.website, phone: lead.phone, address: lead.address,
      maps_url: lead.mapsUrl || lead.maps_url, email: lead.email,
      all_emails: lead.allEmails || lead.all_emails,
      facebook: lead.facebook, instagram: lead.instagram, linkedin: lead.linkedin,
      twitter: lead.twitter, youtube: lead.youtube, tiktok: lead.tiktok,
      pinterest: lead.pinterest, whatsapp: lead.whatsapp, telegram: lead.telegram,
      project: status?.name || selectedProject?.name || form.name,
      query: status?.query || form.query,
    }));
    const data = await jsonFetch("/api/leads", { method: "POST", body: JSON.stringify({ leads: payload }) });
    const saved = Array.isArray(data.leads) ? data.leads : [];
    const pairs = [];
    leadObjs.forEach((lead, i) => {
      if (saved[i] && saved[i].id) pairs.push({ key: leadKey(lead), id: saved[i].id });
    });
    return pairs;
  }

  // Poll every job in a bulk batch and roll the per-job progress into one
  // done/total figure. On completion, refresh credits and — for audits — overlay
  // the fresh scores back onto the captured rows. Mirrors the Leads manager.
  function pollBatch(jobIds, total, kind) {
    clearTimeout(batchPollRef.current);
    const tick = async () => {
      const jobs = await Promise.all(jobIds.map((id) => jsonFetch(`/api/agent/jobs/${id}`).catch(() => null)));
      let done = 0, latest = "", allTerminal = true;
      for (const job of jobs) {
        if (!job) { allTerminal = false; continue; }
        done += (job.results || []).length;
        if (job.status === "running") allTerminal = false;
        const line = (job.log || []).slice(-1)[0];
        if (line) latest = line;
      }
      done = Math.min(done, total);
      const failed = allTerminal ? Math.max(0, total - done) : 0;
      setBatch({ kind, jobIds, total, done, failed, latest, finished: allTerminal });
      if (allTerminal) {
        refreshCredits();
        if (kind === "audit") overlayAuditScores(batchKeyMap.current);
      } else {
        batchPollRef.current = setTimeout(tick, 2500);
      }
    };
    tick();
  }

  // After a bulk audit, pull each audited lead's fresh scores and drop them into
  // the captured-row overlay (the rows come from project status, not the DB).
  async function overlayAuditScores(idKeyMap) {
    await Promise.all(Object.entries(idKeyMap || {}).map(async ([id, key]) => {
      const fresh = await jsonFetch(`/api/leads/${id}`).catch(() => null);
      const l = fresh?.lead;
      if (!l) return;
      setRowOverlay((o) => ({
        ...o,
        [key]: { ...(o[key] || {}), desktop: { performance: l.desktop_performance, seo: l.desktop_seo }, mobile: { performance: l.mobile_performance, seo: l.mobile_seo } },
      }));
    }));
  }

  // Charge + launch a bulk batch (audit or report) over an explicit set of leads
  // that have a website. Saves them to the DB first (for ids), then drives the
  // shared progress card.
  //
  // NOTE: nothing calls this right now. Audit and report were removed from the
  // per-row actions and then from the bulk selection dock, so the workspace has no
  // entry point into it. Kept intact (with pollBatch and the progress card) so the
  // buttons can be re-homed without rebuilding the flow; delete the chain if audit
  // and report are meant to be gone from this page for good.
  async function runBatchForLeads(kind, leadObjs) {
    const billable = (leadObjs || []).filter((l) => l.website);
    const noun = kind === "audit" ? "audit" : "report";
    if (!billable.length) { alert(`None of these leads have a website to ${noun}.`); return; }
    const unit = kind === "audit" ? AUDIT_COST : REPORT_COST;
    const endpoint = kind === "audit" ? "/api/leads/audit/bulk" : "/api/leads/report/bulk";
    const cost = billable.length * unit;
    const have = credits ?? 0;
    if (cost > have) {
      alert(SHOW_CREDITS
        ? `Not enough credits. ${billable.length} ${noun}(s) need ${cost} credits and you have ${have}.`
        : `Your plan doesn't have enough allowance left for ${billable.length} ${noun}(s). Reduce your selection or upgrade in Billing.`);
      return;
    }
    if (!confirm(SHOW_CREDITS
      ? `Run ${billable.length} ${noun}${billable.length === 1 ? "" : "s"}?\n\nThis will use ${cost} credits (${billable.length} × ${unit}). You have ${have}, leaving ${have - cost}.`
      : `Run ${billable.length} ${noun}${billable.length === 1 ? "" : "s"}?`)) return;
    setBulkBusy(kind);
    try {
      const pairs = await ensureSelectedIds(billable);
      const ids = pairs.map((p) => p.id);
      if (!ids.length) throw new Error("Could not save the selected leads.");
      batchKeyMap.current = Object.fromEntries(pairs.map((p) => [p.id, p.key]));
      const data = await jsonFetch(endpoint, { method: "POST", body: JSON.stringify({ ids }) });
      if (typeof data.credits === "number") setCredits(data.credits);
      setSelectedLeads(new Set());
      const jobIds = data.jobIds || [];
      setBatch({ kind, jobIds, total: data.count, done: 0, failed: 0, latest: "Starting…", finished: false });
      if (jobIds.length) pollBatch(jobIds, data.count, kind);
    } catch (err) {
      refreshCredits();
      alert(err.message);
    } finally {
      setBulkBusy("");
    }
  }

  // Realtime (queue-free) batch enrich / WhatsApp over the captured leads. Reuses
  // the same per-lead realtime endpoints as the single-row buttons — nothing is
  // added to the job queue and no browser runner is spawned. Enrichment results
  // persist to the shared cache, so a business enriched once is reused for every
  // user and every future find.
  async function runRealtimeBatch(kind) {
    // Skip leads that are already done: enriched ones (have email/socials or a
    // recorded enrich status) for Enrich, and already WhatsApp-checked numbers
    // (a yes/no result) for WhatsApp — so a re-run only works the leftovers.
    const isEnriched = (l) => !!(l.email || l.enrichStatus || l.enrich_status);
    const isWaChecked = (l) => { const s = waState(l); return s === "yes" || s === "no"; };
    const hasCandidate = (l) => (kind === "enrich" ? !!l.website : !!l.phone);
    const targets = (leads || []).filter((l) => hasCandidate(l) && (kind === "enrich" ? !isEnriched(l) : !isWaChecked(l)));
    if (!targets.length) {
      const anyCandidates = (leads || []).some(hasCandidate);
      if (anyCandidates) {
        showToast(kind === "enrich" ? "All leads with a website are already enriched" : "All numbers are already WhatsApp-checked");
      } else {
        alert(kind === "enrich" ? "No captured leads have a website to enrich." : "No captured leads have a phone to check on WhatsApp.");
      }
      return;
    }
    const handler = kind === "enrich" ? enrichCaptured : whatsappCaptured;
    setBulkBusy(kind);
    setRealtimeBatch({ kind, done: 0, total: targets.length });
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (idx < targets.length) {
        const lead = targets[idx++];
        try { await handler(lead); } catch { /* per-row handler already surfaces its own error */ }
        done++;
        setRealtimeBatch((b) => (b ? { ...b, done } : b));
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(5, targets.length) }, worker));
      showToast(kind === "enrich" ? `Enriched ${done}/${targets.length} lead${targets.length === 1 ? "" : "s"}` : `WhatsApp checked ${done}/${targets.length} number${targets.length === 1 ? "" : "s"}`);
    } finally {
      setBulkBusy("");
      setRealtimeBatch(null);
      refreshCredits();
    }
  }

  // Save the selected rows, then open the shared "Add to list" dialog in bulk mode.
  async function bulkAddToList() {
    if (!selectedLeadObjs.length) return;
    setBulkBusy("list");
    try {
      const pairs = await ensureSelectedIds(selectedLeadObjs);
      if (!pairs.length) throw new Error("Could not save the selected leads.");
      setListsBulk({ ids: pairs.map((p) => p.id), keys: pairs.map((p) => p.key) });
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkBusy("");
    }
  }

  // Remove the selection from this captured view only (local hide) — the leads
  // stay in the database, matching the per-row remove + the Leads-manager rule.
  function bulkRemove() {
    if (!selectedLeadObjs.length) return;
    if (!confirm(`Remove ${selectedLeadObjs.length} lead${selectedLeadObjs.length === 1 ? "" : "s"} from this list? They stay in your leads database.`)) return;
    setRowOverlay((o) => {
      const next = { ...o };
      for (const l of selectedLeadObjs) { const k = leadKey(l); next[k] = { ...(next[k] || {}), __removed: true }; }
      return next;
    });
    setSelectedLeads(new Set());
  }

  // Sidebar project list, nested under the Projects nav item (AppShell's
  // projectsNav slot). It sits inside the nav rather than in its own block, so
  // each row is a single compact line: name, and the lead count as a quiet
  // trailing number. The audit counts moved to the workspace header, because at
  // this size they cost a second line per project and were rarely the reason
  // somebody scanned this list.
  // Sidebar project list. Navigation, not a data table: the name carries the
  // weight, the count sits back, and the selected row is marked with a rule and
  // a faint tint rather than a filled orange block.
  const projectList = (
    <div className="space-y-px py-0.5">
      {runningCount > 1 && (
        <div className="mb-1 flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {runningCount} running
        </div>
      )}
      {projects.slice(0, projectLimit).map((project) => (
        <div
          key={project.slug}
          role="button"
          tabIndex={0}
          onClick={() => setSelected(project.slug)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(project.slug); } }}
          title={getProjectDisplayName(project) || project.name}
          className={cn(
            "group/proj relative flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pl-2.5 pr-2 text-left text-[12.5px] transition-colors",
            project.slug === selected
              ? "bg-primary/[0.07] font-medium text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {project.slug === selected && (
            <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
          )}
          {project.running && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" title="Running" />}
          <span className="min-w-0 flex-1 truncate">{getProjectDisplayName(project) || project.name}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleProjectWatch(project); }}
            className={cn(
              "shrink-0 transition-opacity",
              project.watchlist
                ? "text-amber-500"
                : "text-muted-foreground/50 opacity-0 hover:text-amber-500 focus:opacity-100 group-hover/proj:opacity-100"
            )}
            title={project.watchlist ? "Remove from favorites" : "Add to favorites"}
          >
            <Star size={11} fill={project.watchlist ? "currentColor" : "none"} />
          </button>
          <span className="w-8 shrink-0 text-right tabular-nums text-[10.5px] text-muted-foreground/60">
            <AnimatedNumber value={project.counts?.raw || 0} />
          </span>
        </div>
      ))}
      {!projects.length && <div className="px-2 py-1 text-xs text-muted-foreground">No projects yet</div>}
      {/* "105 more" read as a count of something missing and had to be clicked
          over and over, ten at a time. One click now shows the lot — the list
          scrolls inside its own pane, so a long one costs nothing. */}
      {projects.length > projectLimit && (
        <button
          type="button"
          onClick={() => setProjectLimit(projects.length)}
          className="mt-0.5 flex w-full items-center gap-1 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          View all projects
          <span className="tabular-nums text-muted-foreground/60">({projects.length.toLocaleString()})</span>
        </button>
      )}
    </div>
  );

  if (simpleMode) {
    const openProjects = () => {
      setIsTransitioningOut(true);
      setTimeout(() => {
        router.push("/dashboard?view=projects");
      }, 300);
    };
    // "Where are my projects?" is account state, not part of the search, so it
    // belongs in the topbar — not in a strip above the heading, where it pushed
    // the heading and the entire form down a row before the user had read a
    // word of it.
    const findActions = (
      <div className="hidden items-center gap-2 md:flex">
        <Button variant="outline" size="sm" onClick={openProjects}>
          View my projects <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
    return (
      <AppShell active="new" title="Find leads" actions={findActions} tourKey="find" tourSteps={FIND_TOUR}>
        <div className={cn(
          "transition-all duration-300 ease-out transform origin-center",
          isTransitioningOut ? "opacity-0 scale-95 -translate-y-4" : "opacity-100 scale-100 translate-y-0"
        )}>
          <QuickScrapeHome
            busy={busy}
            onFind={startFindLeads}
            onOpenDashboard={openProjects}
            error={error}
            needPlan={needPlan}
          />
        </div>
        <ExtensionRequiredDialog open={needExtension} onClose={() => setNeedExtension(false)} />
        <LiveSearchOverlay state={scrapeProgress} onClose={() => setScrapeProgress(null)} onStop={stopExtensionScrape} />
      </AppShell>
    );
  }

  // Leads that can actually be plotted. Computed here rather than inside the map
  // panel because the Map tab has to know whether it is worth offering at all —
  // a project of leads without coordinates should not grow a dead tab.
  const geoLeads = leads.filter((l) => Number.isFinite(parseFloat(l.lat)) && Number.isFinite(parseFloat(l.lng)));
  const mapCenter = geoLeads.length
    ? {
        lat: geoLeads.reduce((sum, l) => sum + parseFloat(l.lat), 0) / geoLeads.length,
        lng: geoLeads.reduce((sum, l) => sum + parseFloat(l.lng), 0) / geoLeads.length,
      }
    : null;
  const mapPoints = geoLeads.map((l) => ({ lat: parseFloat(l.lat), lng: parseFloat(l.lng), name: l.name || "" }));

  // Favourite is secondary and Delete is destructive, but neither should shout
  // over the project name they sit beside: both are outlined, and Delete earns
  // its red from the text and border rather than a filled block.
  const actions = (
    <div className="hidden md:flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className={cn("h-8 text-muted-foreground hover:text-foreground", selectedProject?.watchlist && "border-amber-500/40 text-amber-600 hover:text-amber-600")}
        disabled={!selectedProject}
        onClick={() => toggleProjectWatch()}
        title={selectedProject?.watchlist ? "Remove project from favorites" : "Add project to favorites"}
      >
        <Star size={14} fill={selectedProject?.watchlist ? "currentColor" : "none"} /> <span className="hidden sm:inline">Favorite</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
        disabled={!!busy || running || !selected}
        onClick={() => projectAction("delete")}
      >
        <Trash2 size={14} /> <span className="hidden sm:inline">Delete</span>
      </Button>
    </div>
  );

  return (
    <AppShell
      active="dashboard"
      title={getProjectDisplayName(status || selectedProject) || status?.name || selectedProject?.name || "Lead Generation"}
      subtitle={getProjectCrumbs(status || selectedProject, leads[0]) || status?.query || form.query}
      actions={actions}
      projectsNav={projectList}
      tourKey="workspace"
      tourSteps={WORKSPACE_TOUR}
    >
      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
      <FindResultAlert result={scrapeProgress ? null : findResult} onClose={() => setFindResult(null)} />
      <div className="animate-page-in motion-reduce:animate-none space-y-3 overflow-x-clip p-3 sm:p-4">
        {/* Mobile project switcher */}
        {projects.length > 0 && (
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:hidden">
            {projects.slice(0, visibleChipCount).map((p) => (
              <button
                key={p.slug}
                onClick={() => setSelected(p.slug)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                  p.slug === selected ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
                )}
              >
                {p.running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
                {p.watchlist && <Star size={12} fill="currentColor" />}
                {getProjectDisplayName(p) || p.name}
              </button>
            ))}
            {projects.length > visibleChipCount && (
              <button
                onClick={() => setVisibleChipCount((v) => v + 5)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
              >
                +{projects.length - visibleChipCount} more
              </button>
            )}
          </div>
        )}

        {/* KPI strip — one bordered row, four numbers, roughly half the height
            the four cards used to take. What each number counts is the whole
            project, not the filtered view: these are the project's vitals, and
            they should not move every time somebody types in the search box.
            What is in view is stated once, by the table's own count. */}
        {(() => {
          const c = status?.counts || {};
          const total = c.raw || allLeads.length || 0;
          const pct = (n) => (total > 0 && n > 0 ? `${Math.min(100, Math.round((n / total) * 100))}% of leads` : null);
          const websites = c.websites ?? allLeads.filter((l) => l.website).length;
          const emails = allLeads.filter((l) => l.email).length;
          // Averaged over the whole project for the same reason as the rest of
          // the strip. A word alone ("Medium") is not actionable, and a number
          // alone means nothing, so the score leads and the band explains it.
          const avg = allLeads.length
            ? Math.round(allLeads.reduce((sum, l) => sum + scoreLead(l).score, 0) / allLeads.length)
            : 0;
          const avgBand = avg >= 65 ? "high" : avg >= 40 ? "medium" : "low";
          return (
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-x sm:divide-border [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-border [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-border sm:[&>*]:border-b-0 sm:[&>*:nth-child(odd)]:border-r-0">
              <Kpi icon={Database} value={total} label="Leads found"
                hint={c.enriched ? `${Number(c.enriched).toLocaleString()} enriched` : null} />
              <Kpi icon={Globe2} value={websites} label="With website" hint={pct(websites)} />
              <Kpi icon={Mail} value={emails} label="With email" hint={pct(emails)} />
              <Kpi icon={TrendingUp} text={`${avg}/100`} label="Opportunity score"
                hint={allLeads.length ? `${BAND_LABEL[avgBand]} across ${allLeads.length.toLocaleString()} leads` : null} />
            </div>
          );
        })()}

        {/* Project-level controls. Only rendered when it has something to say —
            after Enrich/WhatsApp moved into the table toolbar this card was an
            empty white band on a project that is simply sitting idle. The mobile
            favorite/delete pair keeps it alive on small screens. */}
        {(running || isQueued || busy || formRunning) && (
        <Card>
          <CardContent className="space-y-3 p-3">
            {/* Action buttons (placed at the top on mobile, bottom on desktop) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/40 pb-3 sm:border-0 sm:pb-0">
              <div className="flex flex-wrap gap-2">
                {/* Enrich / WhatsApp now live in the table toolbar, next to the
                    selection they act on. What stays here is project-level: stop
                    a running job, and the mobile favorite/delete pair. */}
                {/* Stop only shows while a job is actually running. Resume used to
                    take this slot the rest of the time, offering to restart a
                    project that had already finished everything it was asked for. */}
                {running && (
                  <Button variant="outline" disabled={!!busy} onClick={() => projectAction("stop")}><PauseCircle size={16} /> Stop</Button>
                )}
                {/* Mobile-only Favorite/Delete buttons */}
                <Button
                  variant="outline"
                  size="icon"
                  className={cn("sm:hidden h-9 w-9", selectedProject?.watchlist && "border-amber-500/50 text-amber-600")}
                  disabled={!selectedProject}
                  onClick={() => toggleProjectWatch()}
                  title={selectedProject?.watchlist ? "Remove project from favorites" : "Add project to favorites"}
                >
                  <Star size={15} fill={selectedProject?.watchlist ? "currentColor" : "none"} />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  className="sm:hidden h-9 w-9"
                  disabled={!!busy || running || !selected}
                  onClick={() => projectAction("delete")}
                  title="Delete project"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>

            {formRunning && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                "{form.name}" is already running. Change the project name to launch another in parallel.
              </div>
            )}

            {/* Only shown while something is actually happening. At rest this line
                said "Ready" or "Done", which is what the page already looks like;
                the states worth a line are an action in flight, a running job, or
                a job sitting in the queue. */}
            {(busy || running || isQueued) && (
              <div className={cn(
                "text-xs",
                isQueued && !busy ? "font-medium text-amber-600" : "text-muted-foreground"
              )}>
                {busy
                  ? busy
                  : running
                    ? "Running…"
                    : <span>Queued, waiting for a free slot{queuedFor ? <span className="ml-1 text-muted-foreground font-normal">· {queuedFor < 60 ? `${queuedFor}s` : `${Math.floor(queuedFor / 60)}m ${queuedFor % 60}s`} so far</span> : ""}</span>}
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {error && (
          <div className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
            needPlan ? "border-primary/40 bg-primary/10 text-foreground" : "border-destructive/40 bg-destructive/10 text-red-600"
          )}>
            <span>{error}</span>
            {needPlan && (
              <Button asChild size="sm">
                <Link href="/billing"><CreditCard size={15} /> Choose a plan</Link>
              </Button>
            )}
          </div>
        )}

        <EnrichProgress progress={status?.enrichProgress} stage={stages.enrich} />

        {/* The workspace: tabs, filters, search, the rows, the pager. One
            bordered surface instead of five stacked cards — the map, the
            filters, the toolbar and the table were all describing the same list,
            and each border around them was another thing to look at before
            reaching a lead. The table is the point of the page, so everything
            above it is a control bar attached to it rather than a card of its
            own. */}
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          {/* Row 1 — where you are, what just happened, and what you can do to
              the selection. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
            {(() => {
              // Map is a view of this same list, not a section above it. As a
              // permanently docked card it spent a strip of every screen saying
              // how many pins it would draw if you opened it.
              const tabs = [
                { key: "leads", label: "Leads", count: leads.length },
                ...(geoLeads.length ? [{ key: "map", label: "Map", count: geoLeads.length }] : []),
              ];
              return (
                <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setWorkspaceTab(t.key);
                        try { localStorage.setItem("lf_ws_tab", t.key); } catch {}
                      }}
                      aria-current={workspaceTab === t.key ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                        workspaceTab === t.key
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t.key === "map" && <MapPin size={12} />}
                      {t.label}
                      <span className="tabular-nums text-[11px] text-muted-foreground">{t.count.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* What the last scrape actually cost, as a line rather than a
                banner. The split between new (charged) and already-yours (free)
                is the only part worth colour. */}
            {status?.state?.dbSync && !hideSyncBanner && (
              <div className="flex min-w-0 items-center gap-1.5 text-xs">
                <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                <span className="truncate">
                  <b className="font-semibold text-emerald-700">{Number(status.state.dbSync.inserted || 0).toLocaleString()} new</b>
                  <span className="text-muted-foreground">
                    {" · "}{Number(status.state.dbSync.updated || 0).toLocaleString()} already saved, not charged
                  </span>
                </span>
                <button
                  onClick={() => setHideSyncBanner(true)}
                  aria-label="Dismiss"
                  className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Bulk actions. Enrich and WhatsApp work on everything in view;
                the rest need a selection, which is why they only appear once
                there is one. */}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {selectedCount > 0 && (
                <>
                  <span className="text-xs font-medium tabular-nums">{selectedCount.toLocaleString()} selected</span>
                  <button
                    onClick={() => setSelectedLeads(new Set())}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                  <span className="mx-0.5 h-4 w-px bg-border" />
                </>
              )}
              <Button variant="outline" size="sm" className="h-8" data-tour="ws-enrich" disabled={!!bulkBusy || !leads.length} onClick={() => runRealtimeBatch("enrich")} title="Grab email + socials for leads not enriched yet (realtime, no queue; shared with all users)">
                {bulkBusy === "enrich" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Enrich{realtimeBatch?.kind === "enrich" ? ` (${realtimeBatch.done}/${realtimeBatch.total})` : ""}
              </Button>
              <Button variant="outline" size="sm" className="h-8" data-tour="ws-whatsapp" disabled={!!bulkBusy || !leads.length} onClick={() => runRealtimeBatch("whatsapp")} title="Check WhatsApp for numbers not checked yet (realtime, no queue; cached for all users)">
                {bulkBusy === "whatsapp" ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} WhatsApp
              </Button>
              {selectedCount > 0 && (
                <Button variant="outline" size="sm" className="h-8" disabled={!!bulkBusy} onClick={bulkAddToList} title="Add the selected leads to a list">
                  {bulkBusy === "list" ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />} Add to list
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8" disabled={!leads.length} onClick={exportLeadsCsv} title="Download the leads in view as CSV">
                <Download size={14} /> Export{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
              {selectedCount > 0 && (
                <Button variant="outline" size="sm" className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={!!bulkBusy} onClick={bulkRemove} title="Remove the selected leads from this project">
                  {bulkBusy === "remove" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
                </Button>
              )}
            </div>
          </div>

          {/* Row 2 — search and qualification filters on one line. These narrow
              the same list the table, the counts and the bulk actions all read
              from, so what you filter to is exactly what you act on. */}
          {allLeads.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
              <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  value={leadSearch}
                  onChange={(e) => { setLeadSearch(e.target.value); setTablePage(0); }}
                  placeholder="Search businesses, contacts, phone, email or address…"
                  className="h-8 border-border bg-card pl-8 text-xs"
                />
              </div>
              {[
                { key: "website", label: "Website", icon: Globe2, options: [["all", "All"], ["yes", "Yes"], ["no", "No"]] },
                { key: "email", label: "Email", icon: Mail, options: [["all", "All"], ["yes", "Yes"], ["no", "No"]] },
                { key: "phone", label: "Phone", icon: MessageCircle, options: [["all", "All"], ["yes", "Yes"], ["no", "No"]] },
                { key: "reviews", label: "Reviews", icon: Star, options: [["all", "All"], ["none", "None"], ["some", "1-20"], ["many", "20+"]] },
              ].map((f) => (
                <FilterSelect
                  key={f.key}
                  label={f.label}
                  icon={f.icon}
                  value={leadFilters[f.key]}
                  options={f.options.map(([value, label]) => ({ value, label, hint: filterCounts[f.key]?.[value] }))}
                  onChange={(v) => { setLeadFilters((st) => ({ ...st, [f.key]: v })); setTablePage(0); }}
                />
              ))}
              <button
                onClick={() => setMoreFilters((v) => !v)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                  moreFilters ? "border-primary/60 bg-primary/[0.06] text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <SlidersHorizontal size={12} /> More
                <ChevronDown size={12} className={cn("transition-transform", moreFilters && "rotate-180")} />
              </button>
              {filtersActive && (
                <button
                  onClick={() => {
                    setLeadFilters({ website: "all", email: "all", phone: "all", reviews: "all", rating: "all", social: "all", enriched: "all" });
                    setLeadSearch("");
                    setTablePage(0);
                  }}
                  className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Clear
                </button>
              )}
              <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                Sort
                <Select
                  value={leadSort}
                  onChange={(e) => { setLeadSort(e.target.value); setTablePage(0); }}
                  className="h-8 w-[130px] border-border bg-card text-xs"
                >
                  <option value="opportunity">Opportunity</option>
                  <option value="found">Order found</option>
                  <option value="name">Name</option>
                  <option value="reviews">Reviews</option>
                  <option value="rating">Rating</option>
                </Select>
              </label>
            </div>
          )}

          {/* Row 3 — the filters that matter once the obvious ones are set.
              Hidden by default so the bar stays a single line. */}
          {allLeads.length > 0 && moreFilters && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 pb-2">
              {[
                { key: "rating", label: "Rating", icon: Star, options: [["all", "All"], ["none", "Unrated"], ["low", "Under 4.0"], ["good", "4.0-4.4"], ["top", "4.5+"]] },
                { key: "enriched", label: "Enriched", icon: Zap, options: [["all", "All"], ["yes", "Yes"], ["no", "Not yet"]] },
              ].map((f) => (
                <FilterSelect
                  key={f.key}
                  label={f.label}
                  icon={f.icon}
                  value={leadFilters[f.key]}
                  options={f.options.map(([value, label]) => ({ value, label, hint: filterCounts[f.key]?.[value] }))}
                  onChange={(v) => { setLeadFilters((st) => ({ ...st, [f.key]: v })); setTablePage(0); }}
                />
              ))}
              {/* Which network, not just "any". Chasing businesses with no
                  Facebook page is a different job from chasing ones with no
                  LinkedIn, so the filter has to name the network. */}
              <FilterSelect
                label="Socials"
                icon={Share2}
                value={leadFilters.social}
                options={[
                  { value: "all", label: "All", hint: filterCounts.social?.all },
                  { value: "any", label: "Has any social", hint: filterCounts.social?.any },
                  { value: "none", label: "Has none", hint: filterCounts.social?.none },
                  { value: "no-facebook", label: "No Facebook", hint: filterCounts.social?.["no-facebook"] },
                  { value: "no-instagram", label: "No Instagram", hint: filterCounts.social?.["no-instagram"] },
                  { value: "no-linkedin", label: "No LinkedIn", hint: filterCounts.social?.["no-linkedin"] },
                  { value: "facebook", label: "Has Facebook", hint: filterCounts.social?.facebook },
                  { value: "instagram", label: "Has Instagram", hint: filterCounts.social?.instagram },
                  { value: "linkedin", label: "Has LinkedIn", hint: filterCounts.social?.linkedin },
                ]}
                onChange={(v) => { setLeadFilters((st) => ({ ...st, social: v })); setTablePage(0); }}
              />
              {filtersActive && (
                <span className="text-[11px] text-muted-foreground">
                  {leads.length.toLocaleString()} of {allLeads.length.toLocaleString()} match
                </span>
              )}
            </div>
          )}

          {/* Map view — mounted only while its tab is open, so Leaflet and its
              tiles still cost nothing until somebody asks for them. */}
          {workspaceTab === "map" && geoLeads.length > 0 && (
            <LeadsMap
              center={mapCenter}
              radiusKm={10}
              points={mapPoints}
              height={520}
              className="w-full"
            />
          )}

          {workspaceTab === "leads" && (
        <div data-tour="ws-leads">
          {!leads.length ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No leads loaded</div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 p-3 md:hidden">
                {pagedLeads.map((lead, idx) => {
                  const index = pageOffset + idx;
                  const key = leadKey(lead);
                  const ownerReplied = lead.owner_replied;
                  return (
                  <div className={cn("cursor-pointer rounded-lg border bg-card/60 p-3", selectedLeads.has(key) ? "border-primary/50 bg-primary/5" : "border-border")} key={`m-${lead.name}-${index}`} onClick={() => openLeadDetail(lead, key)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" aria-label={`Select ${lead.name || "lead"}`} checked={selectedLeads.has(key)} onClick={(e) => e.stopPropagation()} onChange={() => toggleLead(key)} className="mt-0.5 accent-[hsl(var(--primary))]" />
                        {/* #3 row index */}
                        <span className="shrink-0 text-[10px] text-muted-foreground">#{index + 1}</span>
                        <strong className="line-clamp-1 max-w-[200px] text-sm font-medium" title={lead.name || "Unknown"}>
                          {leadMapsHref(lead) ? <a className="text-primary hover:underline" href={leadMapsHref(lead)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{lead.name || "Unknown"}</a> : lead.name || "Unknown"}
                        </strong>
                      </div>
                      <span className="text-xs text-muted-foreground">{lead.category || ""}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      {lead.phone && <WaPhone lead={lead} />}
                      {/* #9 WhatsApp badge: green check on WhatsApp, red X if not */}
                      <WaIcon lead={lead} />
                      {lead.website && <a className="max-w-[160px] truncate text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer" title={lead.website} onClick={(e) => e.stopPropagation()}>{lead.domain || "site"}</a>}
                    </div>
                    {lead.email && <div className="mt-1 text-sm">{contactLocked
                      ? <LockedContact value={lead.email} className="block max-w-[200px] truncate" />
                      : <a className="max-w-[200px] truncate text-primary hover:underline" href={`mailto:${lead.email}`} title={lead.email} onClick={(e) => e.stopPropagation()}>{lead.email}</a>}</div>}
                    {/* #11 rating / reviews / owner reply chips */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {showRating(lead) && <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700"><Star size={10} fill="currentColor" /> {lead.rating}</span>}
                      <span>{reviewCount(lead).toLocaleString()} reviews</span>
                      {ownerReplied === 1 && <span className="text-emerald-600">Owner replied ({lead.owner_reply_count || 0})</span>}
                      {ownerReplied === 0 && <span>Owner: no reply</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Score label="Perf" value={lead.desktop?.performance} />
                      <Score label="SEO" value={lead.desktop?.seo} />
                      <Score label="M-Perf" value={lead.mobile?.performance} />
                    </div>
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}><Socials lead={lead} tone="brand" /></div>
                    <div className="mt-2 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className={cn(lead.__favorited && "text-amber-500")} onClick={() => addCapturedLead(lead, "watchlist")} title={lead.__favorited ? "Added to favorites" : "Add to favorites"}><Star size={14} fill={lead.__favorited ? "currentColor" : "none"} /> Favorite</Button>
                      <Button variant="ghost" size="sm" className={cn(lead.__listed && "text-primary")} disabled={(rowBusy[leadKey(lead)] || {}).list} onClick={() => openListsForCaptured(lead)} title="Add to a list">{(rowBusy[leadKey(lead)] || {}).list ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />} List</Button>
                      <CapturedActions lead={lead} busy={rowBusy[leadKey(lead)] || {}} onEnrich={enrichCaptured} onRemove={hideCaptured} />
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Desktop table. Columns follow what a seller scans for, in order:
                  who they are -> how to reach them -> what they run online ->
                  social proof -> where -> how good a prospect.

                  Rows are tight (h-12) and separated by a hairline rather than
                  boxed: at fifty rows a page, every border and every extra pixel
                  of padding is paid for fifty times. */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 w-8">
                        <input type="checkbox" aria-label="Select all leads" checked={allLeadsSelected} disabled={!leadKeysOnPage.length} onChange={toggleAllLeads} className="accent-[hsl(var(--primary))]" />
                      </TableHead>
                      <TableHead className="h-9">Lead</TableHead>
                      <TableHead className="h-9">Contact</TableHead>
                      <TableHead className="h-9">Presence</TableHead>
                      <TableHead className="h-9">Reviews</TableHead>
                      <TableHead className="h-9">Location</TableHead>
                      <TableHead className="h-9 text-right">
                        <span className="inline-flex items-center gap-1">
                          Opportunity
                          <InfoPopover label="How the opportunity score works" align="right" width="w-80">
                            {OPPORTUNITY_HELP.map((line) => (
                              <span key={line} className="mb-2 block last:mb-0">{line}</span>
                            ))}
                          </InfoPopover>
                        </span>
                      </TableHead>
                      <TableHead className="h-9 w-[104px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLeads.map((lead, idx) => {
                      const index = pageOffset + idx;
                      const key = leadKey(lead);
                      const opp = scoreLead(lead);
                      const reviews = reviewCount(lead);
                      return (
                      <TableRow
                        key={`${lead.name}-${index}`}
                        className={cn(
                          "group/row h-12 cursor-pointer",
                          // Selected and open are different states and have to
                          // look different: a tinted row for selected, plus a
                          // brand rule down the edge for the one that is open.
                          selectedLeads.has(key) && "bg-primary/[0.045]",
                          detailKey === key && "bg-primary/[0.08]"
                        )}
                        onClick={() => openLeadDetail(lead, key)}
                      >
                        <TableCell className="w-8 py-0" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${lead.name || "lead"}`} checked={selectedLeads.has(key)} onChange={() => toggleLead(key)} className="accent-[hsl(var(--primary))]" />
                        </TableCell>

                        {/* Lead — the strongest text on the row, with the category
                            muted underneath it. */}
                        <TableCell className="max-w-[260px] py-0">
                          <div className="flex items-center gap-2.5">
                            <LeadAvatar lead={lead} size={26} />
                            <div className="min-w-0">
                              <div className="truncate text-[13.5px] font-medium leading-tight text-foreground" title={lead.name || "Unknown"}>{lead.name || "Unknown"}</div>
                              <div className="truncate text-[11px] leading-tight text-muted-foreground" title={lead.category || ""}>{lead.category || "-"}</div>
                            </div>
                          </div>
                        </TableCell>

                        {/* Contact — the phone is what gets dialled, so it is the
                            scannable line; the email sits under it. */}
                        <TableCell className="py-0">
                          <div className="flex items-center gap-1.5 text-[13px] font-medium tabular-nums leading-tight">
                            {lead.phone
                              ? <WaPhone lead={lead} onCheck={whatsappCaptured} busy={(rowBusy[leadKey(lead)] || {}).whatsapp} />
                              : <span className="text-[11px] font-normal text-muted-foreground">No phone</span>}
                            <WaIcon lead={lead} />
                          </div>
                          {lead.email
                            ? (contactLocked
                                ? <LockedContact value={lead.email} className="block max-w-[180px] truncate text-[11px] leading-tight" />
                                : <a className="block max-w-[180px] truncate text-[11px] leading-tight text-muted-foreground transition-colors hover:text-primary" href={`mailto:${lead.email}`} title={lead.email} onClick={(e) => e.stopPropagation()}>{lead.email}</a>)
                            : <span className="text-[11px] leading-tight text-muted-foreground/70">{prettyEnrichStatus(lead.enrichStatus) || "No email"}</span>
                          }
                        </TableCell>

                        {/* Presence — what they actually run. A row of greyed-out
                            icons for every network they don't have was mostly
                            filler; the one absence that sells a service is the
                            website, so that one is spelled out in words and the
                            rest simply aren't drawn. */}
                        <TableCell className="py-0" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            {lead.website ? (
                              <a href={lead.website} target="_blank" rel="noreferrer" title={lead.website} className="inline-flex h-5 w-5 items-center justify-center rounded text-primary transition-colors hover:bg-primary/10">
                                <Globe2 size={14} />
                              </a>
                            ) : (
                              <span className="rounded border border-amber-500/30 bg-amber-500/[0.07] px-1.5 py-px text-[10px] font-medium text-amber-700">No site</span>
                            )}
                            <Socials lead={lead} />
                          </div>
                        </TableCell>

                        {/* Reviews — social proof, so the count leads and the
                            rating qualifies it. */}
                        <TableCell className="py-0">
                          {reviews > 0 ? (
                            <>
                              <div className="text-[13px] font-medium leading-tight tabular-nums">{reviews.toLocaleString()}</div>
                              {showRating(lead) ? (
                                <div className="flex items-center gap-0.5 text-[11px] leading-tight text-muted-foreground">
                                  <Star size={9} className="text-amber-500" fill="currentColor" /> {lead.rating}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/70">None</span>
                          )}
                        </TableCell>

                        <TableCell className="max-w-[200px] py-0">
                          {lead.address
                            ? <span className="block truncate text-[12px] text-muted-foreground" title={lead.address}>{lead.address}</span>
                            : <span className="text-[11px] text-muted-foreground/70">-</span>
                          }
                        </TableCell>

                        {/* Opportunity — a qualification signal, not a coloured
                            cell: a dot in the band's colour, the word, then the
                            score. The tint stays on the chip. */}
                        <TableCell className="py-0">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={cn("inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-medium", BAND_CLASS[opp.band], BAND_RING[opp.band])}>
                              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                              {BAND_LABEL[opp.band]}
                            </span>
                            <span
                              className="w-6 text-right text-[12px] font-semibold tabular-nums text-foreground"
                              title={`${opp.score}/100 from ${opp.coverage}% signal coverage. ${opp.reasons[0] || "no gaps found"}`}
                            >
                              {opp.score}
                            </span>
                          </div>
                        </TableCell>

                        {/* Actions — save and list stay on the row because they
                            are the two things done constantly; everything else
                            moved behind the menu so eight rows don't add up to a
                            wall of small icons. */}
                        <TableCell className="py-0" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            <Button variant="ghost" size="icon" className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", lead.__favorited && "text-amber-500 hover:text-amber-500")} onClick={() => addCapturedLead(lead, "watchlist")} title={lead.__favorited ? "Saved to favorites" : "Save to favorites"}><Star size={14} fill={lead.__favorited ? "currentColor" : "none"} /></Button>
                            <Button variant="ghost" size="icon" className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", lead.__listed && "text-primary hover:text-primary")} disabled={(rowBusy[leadKey(lead)] || {}).list} onClick={() => openListsForCaptured(lead)} title="Add to a list">{(rowBusy[leadKey(lead)] || {}).list ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />}</Button>
                            <RowActionsMenu lead={lead} busy={rowBusy[leadKey(lead)] || {}} onEnrich={enrichCaptured} onRemove={hideCaptured} />
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
          )}

        {/* Pager — the section's footer rather than a floating strip below it,
            with the range spelled out on the left the way a results footer
            normally reads. */}
        {workspaceTab === "leads" && leads.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Showing {(pageOffset + 1).toLocaleString()} to {Math.min(pageOffset + WORKSPACE_PAGE_SIZE, leads.length).toLocaleString()} of {leads.length.toLocaleString()} leads
            </span>
            {tablePageCount > 1 && (() => {
              // First, last, and a window around the current page; gaps collapse
              // to an ellipsis so 60 pages stay a single row of controls.
              const pages = [];
              for (let i = 0; i < tablePageCount; i++) {
                if (i === 0 || i === tablePageCount - 1 || Math.abs(i - safeTablePage) <= 1) pages.push(i);
                else if (pages[pages.length - 1] !== "…") pages.push("…");
              }
              return (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous page" disabled={safeTablePage === 0} onClick={() => setTablePage((n) => Math.max(0, n - 1))}>
                    <ChevronDown size={15} className="rotate-90" />
                  </Button>
                  {pages.map((pageNum, i) =>
                    pageNum === "…" ? (
                      <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={pageNum}
                        onClick={() => setTablePage(pageNum)}
                        aria-current={pageNum === safeTablePage ? "page" : undefined}
                        className={cn(
                          "h-8 min-w-8 rounded-md px-2 text-xs font-medium tabular-nums transition-colors",
                          pageNum === safeTablePage ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {pageNum + 1}
                      </button>
                    )
                  )}
                  <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next page" disabled={safeTablePage >= tablePageCount - 1} onClick={() => setTablePage((n) => Math.min(tablePageCount - 1, n + 1))}>
                    <ChevronDown size={15} className="-rotate-90" />
                  </Button>
                </div>
              );
            })()}
          </div>
        )}
        </section>
      </div>
      {/* Bulk selection dock. The checkboxes, the selection state and every bulk
          handler already existed, but nothing ever rendered them — BottomDock was
          added and left unwired, so ticking rows did nothing visible. It portals
          to <body> (see BottomDock) to escape the page-in transform. */}
      {selectedCount > 0 && (
        <BottomDock>
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
            <span className="px-1 text-sm font-medium tabular-nums">
              {selectedCount.toLocaleString()} selected
            </span>
            <span className="h-4 w-px bg-border" />
            <Button size="sm" variant="outline" onClick={bulkAddToList} disabled={!!bulkBusy}>
              {bulkBusy === "list" ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />}
              Add to list
            </Button>
            <Button size="sm" variant="outline" onClick={exportLeadsCsv}>
              <Download size={15} /> Export
            </Button>
            <Button size="sm" variant="outline" onClick={bulkRemove} disabled={!!bulkBusy}>
              <Trash2 size={15} /> Remove
            </Button>
            <button
              type="button"
              onClick={() => setSelectedLeads(new Set())}
              aria-label="Clear selection"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X size={15} />
            </button>
          </div>
        </BottomDock>
      )}

      {/* Lead detail drawer — opens on a row click. Rendered as a slide-over so
          the table keeps its full width; on desktop it docks to the right edge. */}
      <Sheet open={!!detailLead} onOpenChange={(o) => !o && closeLeadDetail()}>
        <SheetContent side="right" showClose={false} className="max-w-sm p-0">
          <LeadDetailPanel
            lead={detailLead}
            locked={contactLocked}
            enriching={!!(rowBusy[detailKey] || {}).enrich}
            onClose={() => closeLeadDetail()}
            onEnrich={enrichCaptured}
            onToggleFavorite={(l) => addCapturedLead(l, "watchlist")}
          />
        </SheetContent>
      </Sheet>

      {listsLead && (
        <ListsDialog
          lead={listsLead}
          onClose={() => setListsLead(null)}
          onChanged={() => {
            // Light up the row's list icon once it's been added to a list.
            if (listsLead.__key) setRowOverlay((o) => ({ ...o, [listsLead.__key]: { ...(o[listsLead.__key] || {}), __listed: true } }));
          }}
        />
      )}
      {listsBulk && (
        <ListsDialog
          ids={listsBulk.ids}
          onClose={() => setListsBulk(null)}
          onChanged={() => {
            setRowOverlay((o) => {
              const next = { ...o };
              for (const k of listsBulk.keys) next[k] = { ...(next[k] || {}), __listed: true };
              return next;
            });
            showToast(`Added ${listsBulk.ids.length} lead${listsBulk.ids.length === 1 ? "" : "s"} to your list`);
            setSelectedLeads(new Set());
          }}
        />
      )}

      {/* Live bulk progress (reports or audits): a fixed card polling every job. */}
      {batch && (() => {
        const isAudit = batch.kind === "audit";
        const noun = isAudit ? "audit" : "report";
        const pct = batch.total ? Math.round((batch.done / batch.total) * 100) : 0;
        return (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-card p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {batch.finished ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Loader2 size={16} className="animate-spin text-primary" />}
              {batch.finished
                ? batch.failed ? `${batch.done} of ${batch.total} ${noun}s done` : isAudit ? "All audits done" : "All reports ready"
                : isAudit ? "Auditing sites…" : "Generating reports…"}
            </div>
            {batch.finished && (
              <button onClick={() => setBatch(null)} className="shrink-0 text-muted-foreground hover:text-foreground" title="Dismiss"><X size={16} /></button>
            )}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-[width] duration-500", batch.finished ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{batch.done} / {batch.total} done{batch.failed ? ` · ${batch.failed} failed` : ""}</span>
            <span>{pct}%</span>
          </div>
          {!batch.finished && batch.latest && <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={batch.latest}>{batch.latest}</p>}
          {batch.finished && <p className="mt-1.5 text-[11px] text-muted-foreground">{isAudit ? "Health scores updated on the audited leads." : "Open any lead to view or download its report."}</p>}
        </div>
        );
      })()}
      <ExtensionRequiredDialog open={needExtension} onClose={() => setNeedExtension(false)} />
        <LiveSearchOverlay state={scrapeProgress} onClose={() => setScrapeProgress(null)} onStop={stopExtensionScrape} />
    </AppShell>
  );
}
