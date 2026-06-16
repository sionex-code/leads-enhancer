"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "./components/app/AppShell";
import AnimatedNumber from "./components/AnimatedNumber";
import ReportModal from "./components/ReportModal";
import { useMe } from "./components/AccountWidget";
import { QUICK_COUNTRIES, QUICK_SERVICES } from "./lib/quickSearchData";
import {
  BarChart3,
  Brush,
  Clock3,
  FileText,
  Globe2,
  ListPlus,
  Loader2,
  Mail,
  MessageCircle,
  PauseCircle,
  Play,
  OctagonX,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Zap,
  ChevronDown,
  CreditCard,
  ArrowRight,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Progress } from "./components/ui/progress";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { cn } from "./lib/utils";

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

const SOCIAL_FIELDS = [
  ["facebook", "FB"],
  ["instagram", "IG"],
  ["linkedin", "LI"],
  ["twitter", "X"],
  ["youtube", "YT"],
  ["tiktok", "TT"],
  ["pinterest", "Pin"],
  ["whatsapp", "WA"],
  ["telegram", "TG"],
];

function Socials({ lead }) {
  const present = SOCIAL_FIELDS.filter(([key]) => lead[key]);
  if (!present.length) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {present.map(([key, label]) => (
        <a
          key={key}
          href={lead[key]}
          target="_blank"
          rel="noreferrer"
          title={lead[key]}
          className="inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {label}
        </a>
      ))}
    </div>
  );
}

// Per-row actions on the captured-leads table: grab email/socials, check
// WhatsApp, open the website report, and remove from this list.
function CapturedActions({ lead, busy = {}, onEnrich, onWhatsapp, onReport, onRemove }) {
  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8" title={lead.email ? "Re-grab email + socials" : "Grab email + socials"} disabled={!lead.website || busy.enrich} onClick={() => onEnrich(lead)}>
        {busy.enrich ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" title={lead.phone ? "Check WhatsApp" : "No phone to check"} disabled={!lead.phone || busy.whatsapp} onClick={() => onWhatsapp(lead)}>
        {busy.whatsapp ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
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

// A plain-language legend so the numbers aren't cryptic. Shown above the table.
function ScoreLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <strong className="font-medium text-foreground">Website health</strong>
      <span>real-Chrome audit score (0-100, higher is better). Perf = page speed, SEO = search readiness.</span>
      <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-600">90-100 Good</span>
      <span className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-600">50-89 Needs work</span>
      <span className="inline-flex items-center rounded-md bg-red-500/15 px-1.5 py-0.5 font-medium text-red-600">0-49 Poor</span>
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
  const remaining = ent?.remaining;
  const unlimited = ent?.active && (remaining === null || ent?.plan === "p99");
  const label = !me
    ? "…"
    : !ent?.active
      ? "No active plan"
      : unlimited
        ? "Unlimited leads"
        : `${Number(remaining || 0).toLocaleString()} leads left`;
  return (
    <Link
      href="/billing"
      title="Manage plan & credits"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50",
        ent?.active ? "border-border bg-card/60 text-foreground" : "border-amber-500/40 bg-amber-500/10 text-amber-600"
      )}
    >
      <CreditCard className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}

function QuickScrapeHome({ busy, onScrape, onOpenDashboard, error, needPlan }) {
  const [countryCode, setCountryCode] = useState(QUICK_COUNTRIES[0].code);
  const country = useMemo(
    () => QUICK_COUNTRIES.find((item) => item.code === countryCode) || QUICK_COUNTRIES[0],
    [countryCode]
  );
  const [service, setService] = useState(QUICK_SERVICES[0]);
  const [city, setCity] = useState(QUICK_COUNTRIES[0].cities[10] || QUICK_COUNTRIES[0].cities[0]);
  const [citySearch, setCitySearch] = useState("");
  const [showChips, setShowChips] = useState(false);
  const [max, setMax] = useState("30");
  const [query, setQuery] = useState(buildQuickQuery(QUICK_SERVICES[0], city, QUICK_COUNTRIES[0]));

  const shownCities = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    return q ? country.cities.filter((item) => item.toLowerCase().includes(q)) : country.cities;
  }, [citySearch, country]);

  function setCountry(nextCode) {
    const nextCountry = QUICK_COUNTRIES.find((item) => item.code === nextCode) || QUICK_COUNTRIES[0];
    const nextCity = nextCountry.cities[0];
    setCountryCode(nextCountry.code);
    setCity(nextCity);
    setCitySearch("");
    setQuery(buildQuickQuery(service, nextCity, nextCountry));
  }

  function selectService(nextService) {
    setService(nextService);
    setQuery(buildQuickQuery(nextService, city, country));
  }

  function selectCity(nextCity) {
    setCity(nextCity);
    setQuery(buildQuickQuery(service, nextCity, country));
  }

  function submit(e) {
    e.preventDefault();
    const cleanQuery = query.trim() || buildQuickQuery(service, city, country);
    // If the query still matches the chip selection, use the clean "City Service
    // Leads" name. If the user typed their own query, derive the name from it.
    const isCustom = cleanQuery !== buildQuickQuery(service, city, country);
    const name = isCustom ? projectNameFromQuery(cleanQuery) : quickProjectName(service, city);
    onScrape({
      ...blankForm,
      name,
      query: cleanQuery,
      max,
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-16">
      <div className="mb-8 flex items-center justify-between gap-3">
        <CreditsPill />
        <button
          type="button"
          onClick={onOpenDashboard}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          View my projects <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="text-center">
        <Badge variant="outline" className="mb-4 gap-1.5"><Zap className="h-3 w-3 text-primary" /> Google Maps lead engine</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">What leads do you want to find?</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Pick a service and city, or type your own query, and we'll pull the leads, enrich contacts, and audit their sites.
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

      <form className="mt-8 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="plumber in Austin TX"
            className="h-12 pl-10 text-base"
            autoFocus
          />
        </div>
        <Button type="submit" size="lg" className="h-12" disabled={!!busy || !query.trim()}>
          <Play size={16} /> Find leads
        </Button>
      </form>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Service</span>
          <Select value={service} onChange={(e) => selectService(e.target.value)}>
            {QUICK_SERVICES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Country</span>
          <Select value={countryCode} onChange={(e) => setCountry(e.target.value)}>
            {QUICK_COUNTRIES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">City</span>
          <Select value={city} onChange={(e) => selectCity(e.target.value)}>
            {country.cities.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Leads</span>
          <Input value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
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
                {QUICK_SERVICES.map((item) => (
                  <Chip key={item} active={service === item} onClick={() => selectService(item)}>{item}</Chip>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {QUICK_COUNTRIES.map((item) => (
                  <Chip key={item.code} active={countryCode === item.code} onClick={() => setCountry(item.code)}>{item.short}</Chip>
                ))}
              </div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{country.label}</h2>
                <Input
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Find city"
                  className="h-8 w-40"
                />
              </div>
              <div className="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto">
                {shownCities.map((item) => (
                  <Chip key={item} active={city === item} onClick={() => selectCity(item)}>{item}</Chip>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold"><AnimatedNumber value={value} /></div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard({ view = "" }) {
  const router = useRouter();
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
  // Per-row state for the captured-leads table actions (enrich / whatsapp / report
  // / remove). The leads list itself is rebuilt from project status on every poll,
  // so action results and removals are kept in an overlay keyed by a stable lead
  // key and merged back on top of the polled rows.
  const [rowBusy, setRowBusy] = useState({});
  const [rowOverlay, setRowOverlay] = useState({});
  const [reportLead, setReportLead] = useState(null);

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
    setProjects(data.projects || []);
    if (!selected && data.projects?.[0]) setSelected(data.projects[0].slug);
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

  async function run(stages, formOverride = form) {
    const runForm = formOverride || form;
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
      if (err.code === "no_plan" || err.code === "quota_exceeded") setNeedPlan(true);
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
    if (ok) router.push("/dashboard?view=projects");
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
    setError("");
    try {
      await jsonFetch(`/api/projects/${encodeURIComponent(item.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ watchlist: !item.watchlist }),
      });
      await loadProjects();
      if (item.slug === selected) await loadStatus(item.slug);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addCapturedLead(lead, target) {
    const notes =
      target === "contact_list"
        ? prompt("Notes for this custom list item", lead.notes || "")
        : "";
    if (notes === null) return;
    setBusy(target === "watchlist" ? "Adding watch" : "Adding list");
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
      setError(err.message);
    } finally {
      setBusy("");
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
  // Trust either source: the projects list (authoritative, refreshed every tick)
  // or the selected project's status. This keeps the Stop button enabled even
  // when a status fetch is mid-flight or briefly stale after switching projects.
  const running = !!status?.state?.activeAlive || !!selectedProject?.running;
  const runningCount = projects.filter((p) => p.running).length;

  // Sidebar project list (rendered into AppShell's sidebarExtra slot).
  const projectList = (
    <div className="space-y-3 pb-4">
      {runningCount > 1 && (
        <div className="rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary">{runningCount} projects running</div>
      )}
      <div className="space-y-1">
        {projects.map((project) => (
          <button
            key={project.slug}
            onClick={() => setSelected(project.slug)}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
              project.slug === selected ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                {project.running && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" title="Running" />}
                {project.watchlist && <Star size={12} className="shrink-0 text-amber-600" fill="currentColor" />}
                <span className="truncate">{project.name}</span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                <AnimatedNumber value={project.counts?.raw || 0} /> leads · {project.counts?.desktopAudits || 0}/{project.counts?.mobileAudits || 0} audits
              </span>
            </span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); toggleProjectWatch(project); }}
              className={cn("shrink-0 pt-0.5", project.watchlist ? "text-amber-600" : "text-muted-foreground hover:text-amber-600")}
              title={project.watchlist ? "Remove from watch list" : "Add to watch list"}
            >
              <Star size={14} fill={project.watchlist ? "currentColor" : "none"} />
            </span>
          </button>
        ))}
        {!projects.length && <div className="px-2.5 text-sm text-muted-foreground">No projects yet</div>}
      </div>
    </div>
  );

  if (simpleMode) {
    return (
      <AppShell active="new" title="Find leads" subtitle="Start a Google Maps lead project">
        <QuickScrapeHome busy={busy} onScrape={startQuickScrape} onOpenDashboard={() => router.push("/dashboard?view=projects")} error={error} needPlan={needPlan} />
      </AppShell>
    );
  }

  const actions = (
    <>
      <CreditsPill />
      <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
        <Search size={15} /> <span className="hidden sm:inline">New search</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(selectedProject?.watchlist && "border-amber-500/50 text-amber-600")}
        disabled={!selectedProject}
        onClick={() => toggleProjectWatch()}
        title={selectedProject?.watchlist ? "Remove project from watch list" : "Add project to watch list"}
      >
        <Star size={15} fill={selectedProject?.watchlist ? "currentColor" : "none"} /> <span className="hidden sm:inline">Watch</span>
      </Button>
      <Button variant="destructive" size="sm" disabled={!!busy || running || !selected} onClick={() => projectAction("delete")}>
        <Trash2 size={15} /> <span className="hidden sm:inline">Delete</span>
      </Button>
    </>
  );

  return (
    <AppShell
      active="dashboard"
      title={status?.name || selectedProject?.name || "Lead Generation"}
      subtitle={status?.query || form.query}
      actions={actions}
      sidebarExtra={projectList}
    >
      <div className="space-y-5 p-4 sm:p-6">
        {/* Mobile project switcher */}
        {projects.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
            {projects.map((p) => (
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
                {p.name}
              </button>
            ))}
          </div>
        )}

        {/* Run form */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-[1.2fr_2fr_0.6fr]">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Project</span>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Maps query</span>
                <Input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Leads</span>
                <Input value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
              </label>
            </div>
            {formRunning && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                "{form.name}" is already running. Change the project name to launch another in parallel.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!busy || formRunning} onClick={() => run(["scrape", "enrich", "whatsapp", "audit", "report"])}>
                <Play size={16} /> Run all
              </Button>
              <Button variant="secondary" disabled={!!busy || formRunning} onClick={() => run(["scrape"])}><Search size={16} /> Find leads</Button>
              <Button variant="secondary" disabled={!!busy || formRunning} onClick={() => run(["enrich"])}><Zap size={16} /> Enrich</Button>
              <Button variant="secondary" disabled={!!busy || formRunning} onClick={() => run(["whatsapp"])}><MessageCircle size={16} /> WhatsApp</Button>
              <Button variant="secondary" disabled={!!busy || formRunning} onClick={() => run(["audit"])}><BarChart3 size={16} /> Audit</Button>
              <Button variant="secondary" disabled={!!busy || formRunning} onClick={() => run(["report"])}><FileText size={16} /> Report</Button>
              <Button variant="outline" disabled={!!busy || running || !selected} onClick={() => projectAction("resume")}><RotateCcw size={16} /> Resume</Button>
              <Button variant="outline" disabled={!!busy || !running} onClick={() => projectAction("stop")}><PauseCircle size={16} /> Stop</Button>
              <Button variant="destructive" disabled={!!busy || runningCount === 0} onClick={stopAllProjects} title="Stop every running project and any audit/Chrome processes still running in the background">
                <OctagonX size={16} /> Stop all{runningCount > 0 ? ` (${runningCount})` : ""}
              </Button>
              <Button variant="outline" disabled={!!busy || !selected} onClick={() => projectAction("cleanup")}><Brush size={16} /> Clean browser</Button>
              {status?.files?.report && (
                <Button asChild variant="outline">
                  <a href={`${BASE_PATH}/api/projects/${encodeURIComponent(selected)}/report`} target="_blank" rel="noreferrer"><Globe2 size={16} /> Open report</a>
                </Button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{busy || (running ? "Running…" : status?.state?.message || "Ready")}</div>
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard value={status?.counts?.raw || 0} label="Scraped leads" />
          <StatCard value={status?.counts?.websites || 0} label="Websites" />
          <StatCard value={status?.counts?.enriched || 0} label="Enriched rows" />
          <StatCard value={status?.counts?.desktopAudits || 0} label="Desktop audits" />
          <StatCard value={status?.counts?.mobileAudits || 0} label="Mobile audits" />
        </div>

        {/* Credit clarity: only leads new to your account are charged; duplicates you
            already have (matched by website/phone/name) are merged for free. */}
        {status?.state?.dbSync && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            <CreditCard size={13} className="shrink-0 text-primary" />
            <span className="font-medium text-foreground">{Number(status.state.dbSync.inserted || 0).toLocaleString()} new leads</span>
            <span>charged to your plan ·</span>
            <span className="font-medium text-foreground">{Number(status.state.dbSync.updated || 0).toLocaleString()} already in your leads</span>
            <span>(free — matched by website / phone / name)</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stage title="Find leads" stage={busy?.includes("scrape") && !stages.scrape ? { status: "starting" } : stages.scrape} />
          <Stage title="Enrich" stage={stages.enrich} />
          <Stage title="WhatsApp" stage={stages.whatsapp} />
          <Stage title="Desktop" stage={stages["audit-desktop"]} />
          <Stage title="Mobile" stage={stages["audit-mobile"]} />
          <Stage title="Report" stage={stages.report} />
        </div>

        <EnrichProgress progress={status?.enrichProgress} stage={stages.enrich} />

        <ScoreLegend />

        <Card className="overflow-hidden">
          {!leads.length ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No leads loaded</div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 p-3 md:hidden">
                {leads.map((lead, index) => (
                  <div className="rounded-lg border border-border bg-card/60 p-3" key={`m-${lead.name}-${index}`}>
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-sm font-medium">{lead.mapsUrl ? <a className="text-primary hover:underline" href={lead.mapsUrl} target="_blank" rel="noreferrer">{lead.name || "Unknown"}</a> : lead.name || "Unknown"}</strong>
                      <span className="text-xs text-muted-foreground">{lead.category || ""}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      {lead.phone && <span>{lead.phone}</span>}
                      {lead.whatsappExists === "yes" && <Badge variant="success">WA ✓</Badge>}
                      {lead.whatsappExists === "no" && <Badge variant="destructive">WA ✗</Badge>}
                      {lead.website && <a className="text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.domain || "site"}</a>}
                    </div>
                    {lead.email && <div className="mt-1 text-sm"><a className="text-primary hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></div>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Score label="Perf" value={lead.desktop?.performance} />
                      <Score label="SEO" value={lead.desktop?.seo} />
                      <Score label="M-Perf" value={lead.mobile?.performance} />
                    </div>
                    <div className="mt-2"><Socials lead={lead} /></div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => addCapturedLead(lead, "watchlist")} title="Add to watch list"><Star size={14} /> Watch</Button>
                      <Button variant="ghost" size="sm" onClick={() => addCapturedLead(lead, "contact_list")} title="Add to custom list with notes"><ListPlus size={14} /> List</Button>
                      <CapturedActions lead={lead} busy={rowBusy[leadKey(lead)] || {}} onEnrich={enrichCaptured} onWhatsapp={whatsappCaptured} onReport={reportCaptured} onRemove={hideCaptured} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Socials</TableHead>
                      <TableHead>Desktop health</TableHead>
                      <TableHead>Mobile health</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead, index) => (
                      <TableRow key={`${lead.name}-${index}`}>
                        <TableCell>
                          {lead.mapsUrl ? <a className="font-medium text-primary hover:underline" href={lead.mapsUrl} target="_blank" rel="noreferrer">{lead.name || "Unknown"}</a> : <span className="font-medium">{lead.name || "Unknown"}</span>}
                          <div className="text-xs text-muted-foreground">{lead.category || lead.address || ""}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {lead.phone || "-"}
                            {lead.whatsappExists === "yes" && <Badge variant="success" title={lead.whatsappId || "On WhatsApp"}>WA ✓</Badge>}
                            {lead.whatsappExists === "no" && <Badge variant="destructive" title="Not on WhatsApp">WA ✗</Badge>}
                          </div>
                          {lead.rating ? <div className="text-xs text-muted-foreground">Rating {lead.rating}</div> : null}
                        </TableCell>
                        <TableCell>
                          {lead.website ? <a className="text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.domain || lead.website}</a> : <span className="text-xs text-muted-foreground">No website</span>}
                        </TableCell>
                        <TableCell>{lead.email || <span className="text-xs text-muted-foreground">{lead.enrichStatus || "-"}</span>}</TableCell>
                        <TableCell><Socials lead={lead} /></TableCell>
                        <TableCell><div className="flex flex-wrap gap-1"><Score label="Perf" value={lead.desktop?.performance} /><Score label="SEO" value={lead.desktop?.seo} /></div></TableCell>
                        <TableCell><div className="flex flex-wrap gap-1"><Score label="Perf" value={lead.mobile?.performance} /><Score label="SEO" value={lead.mobile?.seo} /></div></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-0.5">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => addCapturedLead(lead, "watchlist")} title="Add to watch list"><Star size={14} /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => addCapturedLead(lead, "contact_list")} title="Add to custom list with notes"><ListPlus size={14} /></Button>
                            <CapturedActions lead={lead} busy={rowBusy[leadKey(lead)] || {}} onEnrich={enrichCaptured} onWhatsapp={whatsappCaptured} onReport={reportCaptured} onRemove={hideCaptured} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>
      </div>
      {reportLead && <ReportModal lead={reportLead} onClose={() => setReportLead(null)} />}
    </AppShell>
  );
}
