"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "./components/app/AppShell";
import AnimatedNumber from "./components/AnimatedNumber";
import ReportModal from "./components/ReportModal";
import ListsDialog from "./components/leads/ListsDialog";
import { useMe } from "./components/AccountWidget";
import { QUICK_COUNTRIES, QUICK_SERVICES } from "./lib/quickSearchData";
import {
  BarChart3,
  CheckCircle2,
  X,
  Clock3,
  FileText,
  Globe2,
  ListPlus,
  Loader2,
  Mail,
  MailCheck,
  MessageCircle,
  PauseCircle,
  Play,
  OctagonX,
  RotateCcw,
  Search,
  Send,
  Star,
  Trash2,
  Zap,
  ChevronDown,
  CreditCard,
  Crown,
  ArrowRight,
  SlidersHorizontal,
  MapPin,
  Users,
} from "lucide-react";

import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Progress } from "./components/ui/progress";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { InfoPopover } from "./components/ui/info-popover";
import { cn, waMeLink, waState, prettyEnrichStatus } from "./lib/utils";
import { Socials, WaIcon, WaPhone } from "./components/SocialIcons";

const LeadsMap = dynamic(() => import("./components/LeadsMap"), { ssr: false });

// Guided tour for the "Find leads" page — walks through the search controls in
// order. Targets are data-tour attributes on the form (works on mobile since they
// are all on-screen). Passed to AppShell as tourKey="find".
const FIND_TOUR = [
  { key: "find-service", title: "Pick a service", body: "Choose the type of business you want to reach, such as plumbers, dentists, real estate agencies, and so on." },
  { key: "find-country", title: "Choose a country", body: "Pick the country to search in. The city list below updates to match." },
  { key: "find-city", title: "Pick a city", body: "Select a city, or choose \"All cities\" to search the whole country at once." },
  { key: "find-rating", title: "Filter by rating", body: "Target top-rated businesses, or pick \"Below 4.0\" to find low-rated ones that need help, which is a great angle for selling websites or reputation services." },
  { key: "find-max", title: "How many leads", body: "Set how many leads to pull (up to 10,000). You're only charged 1 credit per brand-new lead." },
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
  { key: "ws-stages", title: "Track progress", body: "Find, Enrich and WhatsApp each show their live status here as they run." },
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
const WORKSPACE_PAGE_SIZE = 200; // captured-leads table page size

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
const OWNER_REPLY_INFO = "Being updated soon — this feature will be available shortly. If you upgraded today, you'll get bonus credits when we release it to existing users.";
const HEALTH_INFO = (
  <>
    Real-Chrome audit score (0-100, higher is better). Perf = page speed, SEO = search readiness.
    <span className="mt-2 flex flex-wrap gap-1">
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-600">90-100 Good</span>
      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-600">50-89 Needs work</span>
      <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-600">0-49 Poor</span>
    </span>
  </>
);
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

function CapturedActions({ lead, busy = {}, onEnrich, onWhatsapp, onAudit, onReport, onRemove }) {
  const waLink = waMeLink(lead);
  const mapsHref = leadMapsHref(lead);
  // Enriched = the website crawl has run (email/socials found, or it reported a
  // status like "no email"). Show a green check so a finished row reads as done.
  const enriched = !!(lead.email || lead.enrichStatus || lead.enrich_status);
  return (
    <>
      {mapsHref && (
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open in Google Maps"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <MapPin size={14} />
        </a>
      )}
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", enriched && "text-emerald-600")} title={enriched ? "Enriched — re-grab email + socials" : "Grab email + socials"} disabled={!lead.website || busy.enrich} onClick={() => onEnrich(lead)}>
        {busy.enrich ? <Loader2 size={14} className="animate-spin" /> : enriched ? <MailCheck size={14} /> : <Mail size={14} />}
      </Button>
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.whatsappExists === "yes" && "text-emerald-600", lead.whatsappExists === "no" && "text-red-600")} title={lead.phone ? (lead.whatsappExists === "yes" ? "On WhatsApp — re-check" : lead.whatsappExists === "no" ? "Not on WhatsApp — re-check" : "Check WhatsApp") : "No phone to check"} disabled={!lead.phone || busy.whatsapp} onClick={() => onWhatsapp(lead)}>
        {busy.whatsapp ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
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
      <Button variant="ghost" size="icon" className="h-8 w-8" title={lead.website ? `Quick audit — desktop + mobile scores (${AUDIT_COST} credits)` : "No website to audit"} disabled={!lead.website || busy.audit} onClick={() => onAudit(lead)}>
        {busy.audit ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" title="Website report" disabled={!lead.website || busy.report} onClick={() => onReport(lead)}>
        {busy.report ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
      </Button>
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

function Stage({ title, stage }) {
  const status = stage?.status || "idle";
  const variant = STAGE_TONE[status] || "outline";
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card/60 px-3 py-2.5">
      <span className="text-sm font-medium">{title}</span>
      <Badge variant={variant} className="capitalize">
        {status === "running" && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
        {status}
      </Badge>
    </div>
  );
}

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
  return `${titled || "Maps"} Leads #${id}`.slice(0, 80);
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
function CreditsPill() {
  const me = useMe();
  const ent = me?.entitlement;
  const unlimited = !!ent?.unlimited;
  const credits = Number(ent?.credits || 0);
  const label = !me
    ? "…"
    : unlimited
      ? "Unlimited credits"
      : credits > 0 || ent?.active
        ? `${credits.toLocaleString()} credits left`
        : "No active plan";
  
  const IconComponent = ent?.active ? Crown : CreditCard;
  
  return (
    <Link
      href="/billing"
      title="Manage plan & credits"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        ent?.active 
          ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_8px_rgba(20,184,166,0.15)] hover:border-primary/60" 
          : "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:border-amber-500/60"
      )}
    >
      <IconComponent className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}

// Short "Xh Ym" until an ISO reset instant — for the searches-left tooltip.
function untilReset(resetAt) {
  if (!resetAt) return "";
  const ms = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

// One live "N/limit left today" pill for a daily metric (searches or leads).
function DailyPill({ icon: Icon, metric, noun, resetAt, tz }) {
  if (!metric || metric.unlimited) return null;
  const remaining = metric.remaining ?? 0;
  const exhausted = remaining <= 0;
  const resetIn = untilReset(resetAt);
  return (
    <span
      title={exhausted
        ? `You've used all ${metric.limit.toLocaleString()} ${noun} today. Resets in ${resetIn} (at midnight ${tz}).`
        : `${remaining.toLocaleString()} of ${metric.limit.toLocaleString()} daily ${noun} left. Resets in ${resetIn} (at midnight ${tz}).`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
        exhausted ? "border-red-500/40 bg-red-500/10 text-red-600" : "border-border bg-card/60 text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {exhausted ? `No ${noun} left` : `${remaining.toLocaleString()} ${noun} left`}
    </span>
  );
}

// Live "searches left today" + "leads left today" pills (reuse the /api/me poll
// behind useMe) so the user always sees what's left of their daily allowance.
// Each pill hides itself for tiers with no cap (unlimited) on that metric.
function DailyUsagePills() {
  const me = useMe();
  const daily = me?.daily;
  if (!me || !daily) return null;
  return (
    <>
      <DailyPill icon={Search} metric={daily.searches} noun="searches" resetAt={daily.resetAt} tz={daily.tz} />
      <DailyPill icon={Users} metric={daily.leads} noun="leads" resetAt={daily.resetAt} tz={daily.tz} />
    </>
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

  // Pick a random element from an array
  const randomPick = (arr) => arr?.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;

  const [isShuffling, setIsShuffling] = useState(false);
  const shuffleIntervalRef = useRef(null);

  const stopShuffle = () => {
    if (shuffleIntervalRef.current) {
      clearInterval(shuffleIntervalRef.current);
      shuffleIntervalRef.current = null;
    }
    setIsShuffling(false);
  };

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
  const [max, setMax] = useState("30");
  // One combined rating filter. "" = any, "gte:N" = N and up, "lt:N" = below N.
  // Mapped to the API's minRating/maxRating on submit so the backend is unchanged.
  const [rating, setRating] = useState("");
  const [allCities, setAllCities] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
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

  // When catalog loads, trigger a smooth slot-machine/shuffle animation settling on random selections
  useEffect(() => {
    if (!catalog) return;
    const countries = catalog.countries || [];
    const services = catalog.services || [];
    if (!countries.length || !services.length) return;

    setIsShuffling(true);
    let ticks = 0;
    const maxTicks = 12;

    shuffleIntervalRef.current = setInterval(() => {
      const randCountry = randomPick(countries);
      const randService = randomPick(services)?.name;
      if (randCountry) {
        setCountryCode(randCountry.code);
        const randCity = randomPick(randCountry.cities) || null;
        setCityObj(randCity);
        if (randCity?.lat != null) setCenter({ lat: randCity.lat, lng: randCity.lng });
        if (randService) {
          setService(randService);
          setQuery(buildQuery(randService, randCity, randCountry));
        } else {
          setQuery(buildQuery(service, randCity, randCountry));
        }
      }
      
      ticks++;
      if (ticks >= maxTicks) {
        stopShuffle();
      }
    }, 70);

    return () => {
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const shownCities = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    return q
      ? (country.cities || []).filter((c) => (c.name || "").toLowerCase().includes(q))
      : (country.cities || []);
  }, [citySearch, country]);

  function changeCountry(nextCode) {
    stopShuffle();
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
    stopShuffle();
    setService(nextService);
    setQuery(buildQuery(nextService, allCities ? null : cityObj, country));
  }

  function selectCity(nextCityObj) {
    stopShuffle();
    setAllCities(false);
    setCityObj(nextCityObj);
    if (nextCityObj?.lat != null && nextCityObj?.lng != null) {
      setCenter({ lat: nextCityObj.lat, lng: nextCityObj.lng });
    }
    setQuery(buildQuery(service, nextCityObj, country));
  }

  // "All cities" searches the whole country (no city/radius filter).
  function selectAllCities() {
    stopShuffle();
    setAllCities(true);
    setQuery(buildQuery(service, null, country));
  }

  function submit(e) {
    e.preventDefault();
    const effectiveCity = allCities ? null : cityObj;
    const cleanQuery = query.trim() || buildQuery(service, effectiveCity, country);
    const isCustom = cleanQuery !== buildQuery(service, effectiveCity, country);
    const isUnknownKeyword = !catalogServices.some(s => 
      cleanQuery.toLowerCase().includes(s.name.toLowerCase())
    );
    const cityLabel = allCities ? (country.name || "All cities") : cityObj?.name || "";
    
    let name;
    if (isUnknownKeyword) {
      const cityPart = allCities ? "" : (cityObj?.name ? `${cityObj.name}, ` : "");
      const countryPart = country?.name || "";
      const baseName = `Leads in ${cityPart}${countryPart}`.trim();
      const id = Date.now().toString(36).slice(-4);
      name = `${baseName} #${id}`;
    } else {
      name = isCustom ? projectNameFromQuery(cleanQuery) : quickProjectName(service, cityLabel);
    }

    onFind({
      name,
      query: cleanQuery,
      cityId: allCities ? null : cityObj?.id || null,
      cityName: allCities ? "" : cityObj?.name || "",
      countryCode: country.code || "",
      countryName: country.name || "",
      service,
      isUnknownKeyword,
      minRating: rating.startsWith("gte:") ? Number(rating.slice(4)) : undefined,
      maxRating: rating.startsWith("lt:") ? Number(rating.slice(3)) : undefined,
      centerLat: allCities ? undefined : center.lat,
      centerLng: allCities ? undefined : center.lng,
      radiusKm: allCities ? undefined : Number(radiusKm) || 10,
      max: String(Math.min(10000, Math.max(1, Math.trunc(Number(max) || 30)))),
    });
  }

  // The chip browser uses the same city objects from the catalog
  const chipCityLabel = (c) => `${c.name}${c.admin ? ", " + c.admin : ""}`;
  // For the select dropdown value we use city id (or name as fallback)
  const citySelectVal = allCities ? "__all__" : cityObj?.id ?? cityObj?.name ?? "";

  return (
    <div className="animate-page-in motion-reduce:animate-none mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-16">
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CreditsPill />
          <DailyUsagePills />
        </div>
        <button
          type="button"
          onClick={onOpenDashboard}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          View my projects <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col items-center text-center">
        <Badge variant="outline" className="mb-4 gap-1.5"><Zap className="h-3 w-3 text-primary" /> Google Maps lead engine</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">What leads do you want to find?</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Pick a service and city, or type your own query, and we'll pull matching leads instantly.
        </p>
      </div>

      {error && (
        <div className={cn(
          "mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
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

      <form className="mt-8 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { stopShuffle(); submit(e); }}>
        <div className="relative flex-1">
          {isShuffling ? (
            <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary animate-spin" />
          ) : (
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            value={query}
            onChange={(e) => {
              stopShuffle();
              setQuery(e.target.value);
            }}
            placeholder="plumber in Austin TX"
            className={cn(
              "h-12 pl-10 text-base transition-all duration-200",
              isShuffling && "border-primary/50 text-primary/80 ring-2 ring-primary/20 bg-primary/5 font-mono"
            )}
            autoFocus
          />
        </div>
        <Button type="submit" size="lg" className="h-12" disabled={!!busy || !query.trim()} data-tour="find-submit">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Find leads
        </Button>
      </form>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <label className="space-y-1" data-tour="find-service">
          <span className="text-xs text-muted-foreground">Service</span>
          <Select value={service} onChange={(e) => selectService(e.target.value)} className="capitalize">
            {catalogServices.map((item) => (
              <option key={item.name} value={item.name}>{titleCase(item.name)}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1" data-tour="find-country">
          <span className="text-xs text-muted-foreground">Country</span>
          <Select value={countryCode} onChange={(e) => changeCountry(e.target.value)}>
            {catalogCountries.map((item) => (
              <option key={item.code} value={item.code}>{item.name}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1" data-tour="find-city">
          <span className="text-xs text-muted-foreground">City</span>
          <Select
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
        <label className="space-y-1" data-tour="find-max">
          <span className="text-xs text-muted-foreground">Leads (max 10,000)</span>
          <Input type="number" min={1} max={10000} value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <label className="space-y-1" data-tour="find-rating">
          <span className="text-xs text-muted-foreground">Rating</span>
          <Select value={rating} onChange={(e) => setRating(e.target.value)} title="Target high-rated businesses or low-rated ones that need help">
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
        <label className="space-y-1 sm:col-span-2" data-tour="find-radius">
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Radius</span>
            <span className="font-medium text-foreground">{allCities ? "country-wide" : `${radiusKm} km`}</span>
          </span>
          <input
            type="range"
            min={1}
            max={200}
            value={radiusKm}
            disabled={allCities}
            onChange={(e) => setRadiusKm(Number(e.target.value) || 1)}
            style={{
              "--slider-percentage": `${((radiusKm - 1) / 199) * 100}%`
            }}
            className="h-9 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          />
        </label>
      </div>

      {/* Area picker map */}
      <div className="mt-4" data-tour="find-map">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          <span>Drag the pin to refine the search center</span>
        </div>
        <LeadsMap
          interactive
          center={center}
          radiusKm={Number(radiusKm) || 10}
          onCenterChange={setCenter}
          height={260}
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
        <div className="mt-6 grid gap-4 lg:grid-cols-[260px_1fr]">
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

function StatCard({ value, label, className }) {
  return (
    <Card className={className}>
      <CardContent className="p-3 sm:p-4">
        <div className="text-xl sm:text-2xl font-bold"><AnimatedNumber value={value} /></div>
        <div className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard({ view = "" }) {
  const router = useRouter();

  const getProjectDisplayName = (p) => {
    if (!p) return "";
    if (p.isUnknownKeyword) {
      const cityPart = p.cityName ? `${p.cityName}, ` : "";
      return `${cityPart}${p.countryName || ""} Leads`;
    }
    return p.name;
  };

  const getProjectDisplayQuery = (p) => {
    if (!p) return "";
    if (p.isUnknownKeyword) {
      const cityPart = p.cityName ? `${p.cityName}, ` : "";
      return `${cityPart}${p.countryName || ""} Leads`;
    }
    return p.query || "";
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
  const [hideSyncBanner, setHideSyncBanner] = useState(false); // dismiss the dbSync banner
  const [tablePage, setTablePage] = useState(0); // captured-leads table pagination
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
  const [reportLead, setReportLead] = useState(null);
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
  const [showDetails, setShowDetails] = useState(false);
  const [credits, setCredits] = useState(null);
  // Full plan entitlement ({ active, remaining, plan, credits }) used to pre-check
  // searches before hitting the server. remaining === null means unlimited.
  const [entitlement, setEntitlement] = useState(null);
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
      setError("You're out of credits. Choose a plan or top up to find more leads.");
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

  // POST to /api/projects/find (warehouse-backed instant delivery).
  // Same plan/quota error handling as run(); same navigation on success.
  async function startFindLeads(findParams) {
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
          minRating: findParams.minRating,
          maxRating: findParams.maxRating,
          centerLat: findParams.centerLat,
          centerLng: findParams.centerLng,
          radiusKm: findParams.radiusKm,
          max: findParams.max,
        }),
      });
      setSelected(data.slug);
      setHideSyncBanner(false);
      setFindResult({ total: data.total ?? 0, inserted: data.inserted ?? 0, updated: data.updated ?? 0 });
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
      showToast("Couldn't update favorite — try again");
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
      showToast("Couldn't add — try again");
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

  async function reportCaptured(lead) {
    const key = leadKey(lead);
    setRowBusyKey(key, "report", true);
    setError("");
    try {
      const saved = await ensureLeadId(lead);
      setReportLead({ id: saved.id, name: saved.name || lead.name, domain: saved.domain || lead.domain, website: saved.website || lead.website });
    } catch (err) {
      setError(err.message);
    } finally {
      setRowBusyKey(key, "report", false);
    }
  }

  // Quick audit for a captured row: save it first (to get an id), run the single
  // audit endpoint, poll it to completion, then drop the fresh desktop/mobile
  // scores into the row overlay so they show in place. Mirrors the Leads manager.
  async function auditCaptured(lead) {
    const key = leadKey(lead);
    if (!confirm(`Audit ${lead.name || "this site"} (desktop + mobile) for ${AUDIT_COST} credits?`)) return;
    setRowBusyKey(key, "audit", true);
    setError("");
    try {
      const saved = await ensureLeadId(lead);
      const data = await jsonFetch(`/api/leads/${saved.id}/audit`, { method: "POST" });
      // Audit credits are charged up front — reflect the new balance immediately.
      if (typeof data.credits === "number") setCredits(data.credits);
      await new Promise((resolve) => {
        const tick = async () => {
          const job = await jsonFetch(`/api/agent/jobs/${data.jobId}`).catch(() => null);
          if (!job || job.status === "running") { setTimeout(tick, 2500); return; }
          resolve();
        };
        tick();
      });
      const fresh = await jsonFetch(`/api/leads/${saved.id}`).catch(() => null);
      const l = fresh?.lead;
      if (l) {
        setRowOverlay((o) => ({
          ...o,
          [key]: {
            ...(o[key] || {}),
            desktop: { performance: l.desktop_performance, seo: l.desktop_seo },
            mobile: { performance: l.mobile_performance, seo: l.mobile_seo },
          },
        }));
      }
      showToast("Audit complete — scores updated");
    } catch (err) {
      setError(err.message);
    } finally {
      setRowBusyKey(key, "audit", false);
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

  // Remove from this captured list only (local hide) — it stays in the global
  // leads database, matching the rule that the overall view owns deletion.
  function hideCaptured(lead) {
    const key = leadKey(lead);
    setRowOverlay((o) => ({ ...o, [key]: { ...(o[key] || {}), __removed: true } }));
  }

  const stages = status?.state?.stages || {};
  const leads = (status?.leads || [])
    .map((l) => ({ ...l, ...(rowOverlay[leadKey(l)] || {}) }))
    .filter((l) => !l.__removed);
  // Paginate the captured-leads table at 200/page so huge finds don't render
  // thousands of rows at once.
  const tablePageCount = Math.max(1, Math.ceil(leads.length / WORKSPACE_PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, tablePageCount - 1);
  const pagedLeads = leads.slice(safeTablePage * WORKSPACE_PAGE_SIZE, safeTablePage * WORKSPACE_PAGE_SIZE + WORKSPACE_PAGE_SIZE);
  const pageOffset = safeTablePage * WORKSPACE_PAGE_SIZE;
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
  const reportableLeads = selectedLeadObjs.filter((l) => l.website);
  const reportableCount = reportableLeads.length;
  const auditCost = reportableCount * AUDIT_COST;
  const reportCost = reportableCount * REPORT_COST;
  const allLeadsSelected = leadKeysOnPage.length > 0 && leadKeysOnPage.every((k) => selectedLeads.has(k));
  const notEnoughForAudit = credits != null && auditCost > credits;
  const notEnoughForReport = credits != null && reportCost > credits;
  const batchRunning = !!batch && !batch.finished;
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
  // shared progress card. Used by BOTH the bulk-selection bar (selected rows) and
  // the project toolbar Audit/Report buttons (every captured lead) — one code path
  // so the two never drift apart.
  async function runBatchForLeads(kind, leadObjs) {
    const billable = (leadObjs || []).filter((l) => l.website);
    const noun = kind === "audit" ? "audit" : "report";
    if (!billable.length) { alert(`None of these leads have a website to ${noun}.`); return; }
    const unit = kind === "audit" ? AUDIT_COST : REPORT_COST;
    const endpoint = kind === "audit" ? "/api/leads/audit/bulk" : "/api/leads/report/bulk";
    const cost = billable.length * unit;
    const have = credits ?? 0;
    if (cost > have) { alert(`Not enough credits. ${billable.length} ${noun}(s) need ${cost} credits and you have ${have}.`); return; }
    if (!confirm(`Run ${billable.length} ${noun}${billable.length === 1 ? "" : "s"}?\n\nThis will use ${cost} credits (${billable.length} × ${unit}). You have ${have}, leaving ${have - cost}.`)) return;
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

  // Bulk-selection bar entry point: run over just the checked rows.
  const runBulkBatch = (kind) => runBatchForLeads(kind, reportableLeads);

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

  // Sidebar project list (rendered into AppShell's sidebarExtra slot).
  const projectList = (
    <div className="space-y-3 pb-4">
      {runningCount > 1 && (
        <div className="rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary">{runningCount} projects running</div>
      )}
      <div className="space-y-1">
        {projects.slice(0, projectLimit).map((project) => (
          <div
            key={project.slug}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(project.slug)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(project.slug); } }}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
              project.slug === selected ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                {project.running && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" title="Running" />}
                <span className="truncate">{getProjectDisplayName(project) || project.name}</span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                <AnimatedNumber value={project.counts?.raw || 0} /> leads · {project.counts?.desktopAudits || 0}/{project.counts?.mobileAudits || 0} audits
              </span>
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleProjectWatch(project); }}
              className={cn("shrink-0 pt-0.5", project.watchlist ? "text-amber-500" : "text-muted-foreground hover:text-amber-500")}
              title={project.watchlist ? "Remove from favorites" : "Add to favorites"}
            >
              <Star size={16} fill={project.watchlist ? "currentColor" : "none"} />
            </button>
          </div>
        ))}
        {!projects.length && <div className="px-2.5 text-sm text-muted-foreground">No projects yet</div>}
        {projects.length > projectLimit && (
          <button
            type="button"
            onClick={() => setProjectLimit((n) => n + 10)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <ChevronDown size={14} /> Load more ({projects.length - projectLimit})
          </button>
        )}
      </div>
    </div>
  );

  if (simpleMode) {
    return (
      <AppShell active="new" title="Find leads" subtitle="Start a Google Maps lead project" tourKey="find" tourSteps={FIND_TOUR}>
        <div className={cn(
          "transition-all duration-300 ease-out transform origin-center",
          isTransitioningOut ? "opacity-0 scale-95 -translate-y-4" : "opacity-100 scale-100 translate-y-0"
        )}>
          <QuickScrapeHome
            busy={busy}
            onFind={startFindLeads}
            onOpenDashboard={() => {
              setIsTransitioningOut(true);
              setTimeout(() => {
                router.push("/dashboard?view=projects");
              }, 300);
            }}
            error={error}
            needPlan={needPlan}
          />
        </div>
      </AppShell>
    );
  }

  const actions = (
    <div className="hidden md:flex items-center gap-2">
      <CreditsPill />
      <DailyUsagePills />
      <Button
        variant="outline"
        size="sm"
        className={cn(selectedProject?.watchlist && "border-amber-500/50 text-amber-600")}
        disabled={!selectedProject}
        onClick={() => toggleProjectWatch()}
        title={selectedProject?.watchlist ? "Remove project from favorites" : "Add project to favorites"}
      >
        <Star size={15} fill={selectedProject?.watchlist ? "currentColor" : "none"} /> <span className="hidden sm:inline">Favorite</span>
      </Button>
      <Button variant="destructive" size="sm" disabled={!!busy || running || !selected} onClick={() => projectAction("delete")}>
        <Trash2 size={15} /> <span className="hidden sm:inline">Delete</span>
      </Button>
    </div>
  );

  return (
    <AppShell
      active="dashboard"
      title={getProjectDisplayName(status || selectedProject) || status?.name || selectedProject?.name || "Lead Generation"}
      subtitle={getProjectDisplayQuery(status || selectedProject) || status?.query || form.query}
      actions={actions}
      sidebarExtra={projectList}
      tourKey="workspace"
      tourSteps={WORKSPACE_TOUR}
    >
      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
      <FindResultAlert result={findResult} onClose={() => setFindResult(null)} />
      <div className="animate-page-in motion-reduce:animate-none space-y-5 overflow-x-clip p-4 sm:p-6">
        {/* Mobile project switcher */}
        {projects.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
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

        {/* Stats — at the top of the workspace */}
        <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-5 md:gap-3 scrollbar-none">
          <StatCard className="w-[110px] shrink-0 md:w-auto md:shrink" value={status?.counts?.raw || 0} label="Scraped leads" />
          <StatCard className="w-[110px] shrink-0 md:w-auto md:shrink" value={status?.counts?.websites || 0} label="Websites" />
          <StatCard className="w-[110px] shrink-0 md:w-auto md:shrink" value={status?.counts?.enriched || 0} label="Enriched rows" />
          <StatCard className="w-[110px] shrink-0 md:w-auto md:shrink" value={status?.counts?.desktopAudits || 0} label="Desktop audits" />
          <StatCard className="w-[110px] shrink-0 md:w-auto md:shrink" value={status?.counts?.mobileAudits || 0} label="Mobile audits" />
        </div>

        {/* Project details (read-only on an existing project) */}
        <Card>
          <CardContent className="space-y-4 p-4">
            {/* Action buttons (placed at the top on mobile, bottom on desktop) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/40 pb-4 sm:border-0 sm:pb-0">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" data-tour="ws-enrich" disabled={!!bulkBusy || !leads.length} onClick={() => runRealtimeBatch("enrich")} title="Grab email + socials for captured leads not enriched yet (realtime, no queue; shared with all users)">
                  {bulkBusy === "enrich" ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Enrich{realtimeBatch?.kind === "enrich" ? ` (${realtimeBatch.done}/${realtimeBatch.total})` : ""}
                </Button>
                <Button variant="secondary" data-tour="ws-whatsapp" disabled={!!bulkBusy || !leads.length} onClick={() => runRealtimeBatch("whatsapp")} title="Check WhatsApp for captured numbers not checked yet (realtime, no queue; cached for all users)">
                  {bulkBusy === "whatsapp" ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />} WhatsApp{realtimeBatch?.kind === "whatsapp" ? ` (${realtimeBatch.done}/${realtimeBatch.total})` : ""}
                </Button>
                {running ? (
                  <Button variant="outline" disabled={!!busy} onClick={() => projectAction("stop")}><PauseCircle size={16} /> Stop</Button>
                ) : (
                  <Button variant="outline" disabled={!!busy || !selected} onClick={() => projectAction("resume")}><RotateCcw size={16} /> Resume</Button>
                )}
                {status?.files?.report && (
                  <Button asChild variant="outline">
                    <a href={`${BASE_PATH}/api/projects/${encodeURIComponent(selected)}/report`} target="_blank" rel="noreferrer"><Globe2 size={16} /> Open report</a>
                  </Button>
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

              {/* Mobile details toggle */}
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center justify-between rounded-md border border-border px-3 h-9 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:hidden"
              >
                <span>{showDetails ? "Hide settings" : "Show settings"}</span>
                <ChevronDown className={cn("ml-1.5 h-3.5 w-3.5 transition-transform duration-200", showDetails && "rotate-180")} />
              </button>
            </div>

            {/* Inputs grid (collapsible on mobile, always visible on desktop) */}
            <div className={cn(
              "grid gap-3 sm:grid-cols-[1.2fr_2fr_0.6fr_0.9fr]",
              showDetails ? "grid grid-cols-1" : "hidden sm:grid"
            )}>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Project</span>
                <Input value={form.name} readOnly className="cursor-default bg-muted/40" title={form.name} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Maps query</span>
                <Input value={getProjectDisplayQuery(status) || form.query} readOnly className="cursor-default bg-muted/40" title={getProjectDisplayQuery(status) || form.query} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Leads</span>
                <Input value={form.max} readOnly className="cursor-default bg-muted/40" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Project ID</span>
                <Input value={status?.state?.publicId || selected || ""} readOnly className="cursor-default bg-muted/40 font-mono uppercase tracking-wide" title="Share this ID with support" />
              </label>
            </div>

            {formRunning && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                "{form.name}" is already running. Change the project name to launch another in parallel.
              </div>
            )}

            <div className={cn(
              "text-xs",
              isQueued && !busy ? "font-medium text-amber-600" : "text-muted-foreground"
            )}>
              {busy
                ? busy
                : running
                  ? "Running…"
                  : isQueued
                    ? <span>Queued — waiting for a free slot{queuedFor ? <span className="ml-1 text-muted-foreground font-normal">· {queuedFor < 60 ? `${queuedFor}s` : `${Math.floor(queuedFor / 60)}m ${queuedFor % 60}s`} so far</span> : ""}</span>
                    : status?.state?.message || "Ready"}
            </div>
          </CardContent>
        </Card>

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

        {/* Credit clarity: only leads new to your account are charged; duplicates you
            already have (matched by website/phone/name) are merged for free. */}
        {status?.state?.dbSync && !hideSyncBanner && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            <CreditCard size={13} className="shrink-0 text-primary" />
            <span>
              <b className="font-semibold text-foreground">{Number(status.state.dbSync.inserted || 0).toLocaleString()} new leads</b>
              {" "}added to this project
            </span>
            <span>·</span>
            <span>
              <b className="font-semibold text-foreground">{Number(status.state.dbSync.updated || 0).toLocaleString()}</b>
              {" "}were already in your saved leads (no extra charge)
            </span>
            <button onClick={() => setHideSyncBanner(true)} aria-label="Dismiss" className="ml-auto text-muted-foreground transition-colors hover:text-foreground"><X size={13} /></button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3" data-tour="ws-stages">
          <Stage title="Find leads" stage={busy?.includes("scrape") && !stages.scrape ? { status: "starting" } : stages.scrape} />
          <Stage title="Enrich" stage={stages.enrich} />
          <Stage title="WhatsApp" stage={stages.whatsapp} />
        </div>

        <EnrichProgress progress={status?.enrichProgress} stage={stages.enrich} />

        {/* Bulk action bar — add to a list, audit, report, or remove the selection */}
        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
            <span className="font-medium">{selectedCount} selected</span>
            {reportableCount > 0 && (
              <span className="text-muted-foreground">
                {reportableCount} with site · audit <strong className="text-foreground">{auditCost}</strong> / report <strong className="text-foreground">{reportCost}</strong> credits
                {credits != null && <> · balance {credits}</>}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedLeads(new Set())}>Clear</Button>
              <Button variant="outline" size="sm" disabled={!!bulkBusy} onClick={bulkAddToList} title="Add the selected leads to a list">
                {bulkBusy === "list" ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />} Add to list
              </Button>
              <Button variant="outline" size="sm" disabled={!!bulkBusy || batchRunning || reportableCount === 0 || notEnoughForAudit} onClick={() => runBulkBatch("audit")} title={notEnoughForAudit ? "Not enough credits" : `Audit ${reportableCount} site(s) — ${auditCost} credits`}>
                {bulkBusy === "audit" ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />} Audit {reportableCount}
              </Button>
              <Button size="sm" disabled={!!bulkBusy || batchRunning || reportableCount === 0 || notEnoughForReport} onClick={() => runBulkBatch("report")} title={notEnoughForReport ? "Not enough credits" : `Generate ${reportableCount} report(s) — ${reportCost} credits`}>
                {bulkBusy === "report" ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Report {reportableCount}
              </Button>
              <Button variant="destructive" size="sm" disabled={!!bulkBusy} onClick={bulkRemove} title="Remove the selected leads from this list">
                {bulkBusy === "remove" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
              </Button>
            </div>
          </div>
        )}

        {/* Workspace results map — shows when at least one lead has lat/lng */}
        {(() => {
          const geoLeads = leads.filter((l) => Number.isFinite(parseFloat(l.lat)) && Number.isFinite(parseFloat(l.lng)));
          if (!geoLeads.length) return null;
          const avgLat = geoLeads.reduce((s, l) => s + parseFloat(l.lat), 0) / geoLeads.length;
          const avgLng = geoLeads.reduce((s, l) => s + parseFloat(l.lng), 0) / geoLeads.length;
          const mapCenter = { lat: avgLat, lng: avgLng };
          const mapPoints = geoLeads.map((l) => ({ lat: parseFloat(l.lat), lng: parseFloat(l.lng), name: l.name || "" }));
          return (
            <LeadsMap
              center={mapCenter}
              radiusKm={10}
              points={mapPoints}
              height={320}
              className="w-full"
            />
          );
        })()}

        <Card className="overflow-hidden" data-tour="ws-leads">
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
                  <div className={cn("cursor-pointer rounded-lg border bg-card/60 p-3", selectedLeads.has(key) ? "border-primary/50 bg-primary/5" : "border-border")} key={`m-${lead.name}-${index}`} onClick={() => toggleLead(key)}>
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
                    {lead.email && <div className="mt-1 text-sm"><a className="max-w-[200px] truncate text-primary hover:underline" href={`mailto:${lead.email}`} title={lead.email} onClick={(e) => e.stopPropagation()}>{lead.email}</a></div>}
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
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}><Socials lead={lead} /></div>
                    <div className="mt-2 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className={cn(lead.__favorited && "text-amber-500")} onClick={() => addCapturedLead(lead, "watchlist")} title={lead.__favorited ? "Added to favorites" : "Add to favorites"}><Star size={14} fill={lead.__favorited ? "currentColor" : "none"} /> Favorite</Button>
                      <Button variant="ghost" size="sm" className={cn(lead.__listed && "text-primary")} disabled={(rowBusy[leadKey(lead)] || {}).list} onClick={() => openListsForCaptured(lead)} title="Add to a list">{(rowBusy[leadKey(lead)] || {}).list ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />} List</Button>
                      <CapturedActions lead={lead} busy={rowBusy[leadKey(lead)] || {}} onEnrich={enrichCaptured} onWhatsapp={whatsappCaptured} onAudit={auditCaptured} onReport={reportCaptured} onRemove={hideCaptured} />
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Desktop table — columns: # | Name | Contact | Rating | Reviews | Owner reply | Website | Socials | Health | Actions */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <input type="checkbox" aria-label="Select all leads" checked={allLeadsSelected} disabled={!leadKeysOnPage.length} onChange={toggleAllLeads} className="accent-[hsl(var(--primary))]" />
                      </TableHead>
                      {/* #3 row index column */}
                      <TableHead className="w-8 text-center">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Reviews</TableHead>
                      <TableHead><span className="inline-flex items-center gap-1">Owner reply <InfoPopover label="About owner reply">{OWNER_REPLY_INFO}</InfoPopover></span></TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Socials</TableHead>
                      <TableHead><span className="inline-flex items-center gap-1">Desktop health <InfoPopover label="About website health">{HEALTH_INFO}</InfoPopover></span></TableHead>
                      <TableHead>Mobile health</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLeads.map((lead, idx) => {
                      const index = pageOffset + idx;
                      const key = leadKey(lead);
                      const ownerReplied = lead.owner_replied;
                      return (
                      <TableRow key={`${lead.name}-${index}`} className={cn("cursor-pointer", selectedLeads.has(key) && "bg-primary/5")} onClick={() => toggleLead(key)}>
                        <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${lead.name || "lead"}`} checked={selectedLeads.has(key)} onChange={() => toggleLead(key)} className="accent-[hsl(var(--primary))]" />
                        </TableCell>
                        {/* #3 row number */}
                        <TableCell className="w-8 text-center text-xs text-muted-foreground">{index + 1}</TableCell>
                        {/* #4 truncate long name */}
                        <TableCell className="max-w-[200px]">
                          <div className="truncate font-medium" title={lead.name || "Unknown"}>
                            {leadMapsHref(lead) ? <a className="text-primary hover:underline" href={leadMapsHref(lead)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{lead.name || "Unknown"}</a> : lead.name || "Unknown"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground" title={lead.category || lead.address || ""}>{lead.category || lead.address || ""}</div>
                        </TableCell>
                        {/* #11 Contact = email + phone only (no rating, no WA text) */}
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            {lead.phone ? <WaPhone lead={lead} /> : <span className="text-xs text-muted-foreground">-</span>}
                            {/* #9 WhatsApp badge: green check on WhatsApp, red X if not */}
                            <WaIcon lead={lead} />
                          </div>
                          {/* #12 email truncated with tooltip */}
                          {lead.email
                            ? <a className="block max-w-[160px] truncate text-xs text-primary hover:underline" href={`mailto:${lead.email}`} title={lead.email} onClick={(e) => e.stopPropagation()}>{lead.email}</a>
                            : <span className="text-xs text-muted-foreground">{prettyEnrichStatus(lead.enrichStatus) || "-"}</span>
                          }
                        </TableCell>
                        {/* #11 Rating column — only meaningful with reviews */}
                        <TableCell className="text-sm">
                          {showRating(lead)
                            ? <span className="inline-flex items-center gap-0.5 font-medium"><Star size={12} className="text-amber-500" fill="currentColor" /> {lead.rating}</span>
                            : <span className="text-xs text-muted-foreground">-</span>
                          }
                        </TableCell>
                        {/* #11 Reviews column — 0 when empty */}
                        <TableCell className="text-sm tabular-nums">{reviewCount(lead).toLocaleString()}</TableCell>
                        {/* #11 Owner reply column */}
                        <TableCell className="text-sm">
                          {ownerReplied === 1
                            ? <span className="text-emerald-600">Yes ({lead.owner_reply_count || 0})</span>
                            : ownerReplied === 0
                              ? <span className="text-muted-foreground">No</span>
                              : <span className="text-muted-foreground">-</span>
                          }
                        </TableCell>
                        {/* #12 Website truncated with tooltip */}
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {lead.website
                            ? <a className="block max-w-[140px] truncate text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer" title={lead.website}>{lead.domain || lead.website}</a>
                            : <span className="text-xs text-muted-foreground">-</span>
                          }
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}><Socials lead={lead} /></TableCell>
                        <TableCell><div className="flex flex-wrap gap-1"><Score label="Perf" value={lead.desktop?.performance} /><Score label="SEO" value={lead.desktop?.seo} /></div></TableCell>
                        <TableCell><div className="flex flex-wrap gap-1"><Score label="Perf" value={lead.mobile?.performance} /><Score label="SEO" value={lead.mobile?.seo} /></div></TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap items-center gap-0.5">
                            <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.__favorited && "text-amber-500")} onClick={() => addCapturedLead(lead, "watchlist")} title={lead.__favorited ? "Added to favorites" : "Add to favorites"}><Star size={14} fill={lead.__favorited ? "currentColor" : "none"} /></Button>
                            <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.__listed && "text-primary")} disabled={(rowBusy[leadKey(lead)] || {}).list} onClick={() => openListsForCaptured(lead)} title="Add to a list">{(rowBusy[leadKey(lead)] || {}).list ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />}</Button>
                            <CapturedActions lead={lead} busy={rowBusy[leadKey(lead)] || {}} onEnrich={enrichCaptured} onWhatsapp={whatsappCaptured} onAudit={auditCaptured} onReport={reportCaptured} onRemove={hideCaptured} />
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
        </Card>

        {/* Pager — 200 leads per page */}
        {tablePageCount > 1 && (
          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" size="sm" disabled={safeTablePage === 0} onClick={() => setTablePage((n) => Math.max(0, n - 1))}>Previous</Button>
            <span className="text-xs text-muted-foreground">
              {pageOffset + 1}-{Math.min(pageOffset + WORKSPACE_PAGE_SIZE, leads.length)} of {leads.length.toLocaleString()} · page {safeTablePage + 1} of {tablePageCount}
            </span>
            <Button variant="outline" size="sm" disabled={safeTablePage >= tablePageCount - 1} onClick={() => setTablePage((n) => Math.min(tablePageCount - 1, n + 1))}>Next</Button>
          </div>
        )}
      </div>
      {reportLead && <ReportModal lead={reportLead} onClose={() => setReportLead(null)} onCharged={(c) => { if (typeof c === "number") setCredits(c); }} />}
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
    </AppShell>
  );
}
