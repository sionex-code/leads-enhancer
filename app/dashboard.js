"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MobileNav from "./components/MobileNav";
import AnimatedNumber from "./components/AnimatedNumber";
import useSidebarCollapse from "./components/useSidebarCollapse";
import { QUICK_COUNTRIES, QUICK_SERVICES } from "./lib/quickSearchData";
import {
  BarChart3,
  Bot,
  Brush,
  Clock3,
  Database,
  FileText,
  FolderOpen,
  Globe2,
  Home,
  KeyRound,
  ListPlus,
  Loader2,
  Mail,
  MessageCircle,
  PauseCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  OctagonX,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import ReportModal from "./components/ReportModal";

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
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
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

function Score({ label, value }) {
  if (value === "" || value === null || value === undefined)
    return <span className="score-pill empty">{label} —</span>;
  return (
    <span className={`score-pill ${scoreClass(value)}`} title={`${label}: ${value}/100 (real-Chrome audit)`}>
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
  if (!present.length) return <span className="subtle">-</span>;
  return (
    <>
      {present.map(([key, label]) => (
        <a key={key} href={lead[key]} target="_blank" title={lead[key]}>
          {label}
        </a>
      ))}
    </>
  );
}

// Per-row actions on the captured-leads table: grab email/socials, check
// WhatsApp, open the website report, and remove from this list.
function CapturedActions({ lead, busy = {}, onEnrich, onWhatsapp, onReport, onRemove }) {
  return (
    <>
      <button className="ghost" title={lead.email ? "Re-grab email + socials" : "Grab email + socials"} disabled={!lead.website || busy.enrich} onClick={() => onEnrich(lead)}>
        {busy.enrich ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}
      </button>
      <button className="ghost" title={lead.phone ? "Check WhatsApp" : "No phone to check"} disabled={!lead.phone || busy.whatsapp} onClick={() => onWhatsapp(lead)}>
        {busy.whatsapp ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />}
      </button>
      <button className="ghost" title="Website report" disabled={!lead.website || busy.report} onClick={() => onReport(lead)}>
        {busy.report ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
      </button>
      <button className="ghost danger-ghost" title="Remove from this list" onClick={() => onRemove(lead)}>
        <Trash2 size={14} />
      </button>
    </>
  );
}

// A plain-language legend so the numbers aren't cryptic. Shown above the table.
function ScoreLegend() {
  return (
    <div className="legend">
      <strong>Website health</strong> — real-Chrome audit score (0–100, higher is better). Perf = page speed, SEO = search readiness.
      <span className="legend-key good">90–100 Good</span>
      <span className="legend-key avg">50–89 Needs work</span>
      <span className="legend-key poor">0–49 Poor</span>
      <span className="legend-key empty">— not audited</span>
    </div>
  );
}

function Stage({ title, stage }) {
  const status = stage?.status || "idle";
  return (
    <div className="stage">
      <span>{title}</span>
      <span className={`badge ${status}`}>{status}</span>
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
    <section className="panel enrich-progress">
      <div className="enrich-progress-head">
        <div>
          <strong>Enrichment progress</strong>
          <span className="subtle">
            {progress.runDone}/{progress.runTotal || progress.totalSites} sites this run
          </span>
        </div>
        <span className={`badge ${status}`}>{status}</span>
      </div>
      <div className="progress-track" aria-label="Enrichment progress">
        <span style={{ width: `${Math.max(0, Math.min(100, progress.percent || 0))}%` }} />
      </div>
      <div className="progress-meta">
        <span><Clock3 size={13} /> ETA {eta}</span>
        <span>{progress.remaining} remaining</span>
        <span>{progress.withEmail} with email</span>
        <span>{progress.processedSites}/{progress.totalSites} processed overall</span>
      </div>
    </section>
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

function QuickScrapeHome({ busy, onScrape, onOpenDashboard }) {
  const [countryCode, setCountryCode] = useState(QUICK_COUNTRIES[0].code);
  const country = useMemo(
    () => QUICK_COUNTRIES.find((item) => item.code === countryCode) || QUICK_COUNTRIES[0],
    [countryCode]
  );
  const [service, setService] = useState(QUICK_SERVICES[0]);
  const [city, setCity] = useState(QUICK_COUNTRIES[0].cities[10] || QUICK_COUNTRIES[0].cities[0]);
  const [citySearch, setCitySearch] = useState("");
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
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={22} />
          <span className="brand-text">Lead Ops</span>
        </div>
        <nav className="nav">
          <span className="nav-link active" title="Home">
            <Home size={15} /> <span className="nav-text">Home</span>
          </span>
          <button type="button" className="nav-link" onClick={onOpenDashboard} title="Projects">
            <FolderOpen size={15} /> <span className="nav-text">Projects</span>
          </button>
          <Link className="nav-link" href="/leads" title="Leads">
            <Database size={15} /> <span className="nav-text">Leads</span>
          </Link>
          <Link className="nav-link" href="/watchlist" title="Watch list">
            <Star size={15} /> <span className="nav-text">Watch</span>
          </Link>
          <Link className="nav-link" href="/agent" title="Agent">
            <Bot size={15} /> <span className="nav-text">Agent</span>
          </Link>
        </nav>
      </aside>

      <section className="search-home">
      <section className="search-hero">
        <div className="search-hero-head">
          <span className="search-eyebrow">Google Maps lead engine</span>
          <h1>What do you want to scrape?</h1>
          <p className="search-subtitle">
            Pick a service and city, or type your own query — we’ll pull the leads, enrich contacts, and audit their sites.
          </p>
        </div>
        <form className="quick-search" onSubmit={submit}>
          <Search size={22} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="plumber in Austin TX"
            autoFocus
          />
          <button className="primary" disabled={!!busy || !query.trim()}>
            <Play size={16} /> Scrape
          </button>
        </form>

        <div className="quick-controls">
          <label>
            <span>Country</span>
            <select value={countryCode} onChange={(e) => setCountry(e.target.value)}>
              {QUICK_COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>City</span>
            <select value={city} onChange={(e) => selectCity(e.target.value)}>
              {country.cities.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Leads</span>
            <input value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
          <button className="ghost" type="button" onClick={onOpenDashboard}>
            Dashboard
          </button>
        </div>

        <div className="quick-builder">
          <aside className="quick-panel service-panel">
            <h2>Service</h2>
            <div className="quick-chip-grid service-chip-grid">
              {QUICK_SERVICES.map((item) => (
                <button
                  key={item}
                  className={service === item ? "active" : ""}
                  type="button"
                  onClick={() => selectService(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </aside>

          <section className="quick-panel city-panel">
            <div className="country-tabs">
              {QUICK_COUNTRIES.map((item) => (
                <button
                  key={item.code}
                  className={countryCode === item.code ? "active" : ""}
                  type="button"
                  onClick={() => setCountry(item.code)}
                >
                  {item.short}
                </button>
              ))}
            </div>
            <div className="city-panel-head">
              <h2>{country.label}</h2>
              <input
                value={citySearch}
                onChange={(e) => setCitySearch(e.target.value)}
                placeholder="Find city"
              />
            </div>
            <div className="quick-chip-grid city-chip-grid">
              {shownCities.map((item) => (
                <button
                  key={item}
                  className={city === item ? "active" : ""}
                  type="button"
                  onClick={() => selectCity(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
      </section>
      <MobileNav active="projects" />
    </main>
  );
}

function AccountsPanel({ accounts, onAdd, onDelete, onToggle, busy }) {
  const [name, setName] = useState("");
  const [cookies, setCookies] = useState("");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    try {
      await onAdd(name.trim() || `Account ${accounts.length + 1}`, cookies);
      setName("");
      setCookies("");
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <details className="panel accounts">
      <summary className="accounts-head">
        <KeyRound size={16} />
        <strong>Gmail accounts</strong>
        <span className="subtle">
          {accounts.length ? `${accounts.filter((a) => a.enabled).length}/${accounts.length} active · auto-rotated per scrape` : "none yet — scrapes run logged out"}
        </span>
      </summary>
      <div className="accounts-list">
        {accounts.map((a) => (
          <div className={`account-row ${a.enabled ? "" : "off"}`} key={a.id}>
            <label className="account-toggle">
              <input
                type="checkbox"
                checked={!!a.enabled}
                onChange={(e) => onToggle(a.id, e.target.checked)}
              />
              <span>{a.name}</span>
            </label>
            <span className="subtle">used {a.use_count}×</span>
            <button className="danger icon" disabled={!!busy} onClick={() => onDelete(a.id)} title="Remove account">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!accounts.length && <div className="subtle">Paste a Gmail's cookies below to add it.</div>}
      </div>
      <div className="accounts-form">
        <input placeholder="Account label (e.g. gmail #1)" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea
          placeholder='Paste Cookie-Editor JSON for a logged-in Gmail (the array of cookies)…'
          value={cookies}
          onChange={(e) => setCookies(e.target.value)}
          rows={3}
        />
        {err && <div className="account-err">{err}</div>}
        <button className="primary" disabled={!!busy || !cookies.trim()} onClick={submit}>
          <Plus size={15} /> Add account
        </button>
      </div>
    </details>
  );
}

export default function Dashboard() {
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapse();
  const [simpleMode, setSimpleMode] = useState(true);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
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

  async function loadAccounts() {
    const data = await jsonFetch("/api/accounts");
    setAccounts(data.accounts || []);
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
    loadAccounts().catch(() => {});
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function startQuickScrape(nextForm) {
    setForm(nextForm);
    setSimpleMode(false);
    await run(["scrape"], nextForm);
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

  async function addAccount(name, cookies) {
    await jsonFetch("/api/accounts", { method: "POST", body: JSON.stringify({ name, cookies }) });
    await loadAccounts();
  }
  async function deleteAccount(id) {
    setBusy("account");
    try {
      await jsonFetch(`/api/accounts/${id}`, { method: "DELETE" });
      await loadAccounts();
    } finally {
      setBusy("");
    }
  }
  async function toggleAccount(id, enabled) {
    await jsonFetch(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    await loadAccounts();
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

  if (simpleMode) {
    return (
      <QuickScrapeHome
        busy={busy}
        onScrape={startQuickScrape}
        onOpenDashboard={() => setSimpleMode(false)}
      />
    );
  }

  return (
    <main className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <ShieldCheck size={22} />
          <span className="brand-text">Lead Ops</span>
          <button
            className="icon sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        <nav className="nav">
          <span className="nav-link active" title="Projects">
            <FolderOpen size={15} /> <span className="nav-text">Projects</span>
          </span>
          <Link className="nav-link" href="/leads">
            <Database size={15} /> <span className="nav-text">Leads</span>
          </Link>
          <Link className="nav-link" href="/watchlist">
            <Star size={15} /> <span className="nav-text">Watch</span>
          </Link>
          <Link className="nav-link" href="/agent">
            <Bot size={15} /> <span className="nav-text">Agent</span>
          </Link>
        </nav>
        {runningCount > 1 && <div className="running-note">{runningCount} projects running</div>}
        <div className="project-list">
          {projects.map((project) => (
            <button
              className={`project-item ${project.slug === selected ? "active" : ""}`}
              key={project.slug}
              onClick={() => setSelected(project.slug)}
            >
              <span>
                <strong>
                  {project.running && <span className="run-dot" title="Running" />}
                  {project.watchlist && <Star size={13} className="watch-icon" fill="currentColor" />}
                  {project.name}
                </strong>
                <br />
                <span className="subtle">
                  <AnimatedNumber value={project.counts?.raw || 0} /> leads | {project.counts?.desktopAudits || 0}/{project.counts?.mobileAudits || 0} audits
                </span>
              </span>
              <span
                className={`project-watch ${project.watchlist ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleProjectWatch(project);
                }}
                title={project.watchlist ? "Remove from watch list" : "Add to watch list"}
              >
                <Star size={14} fill={project.watchlist ? "currentColor" : "none"} />
              </span>
            </button>
          ))}
          {!projects.length && <div className="subtle">No projects yet</div>}
        </div>
      </aside>

      <section className="project-main">
        <header className="topbar">
          <div>
            <h1>{status?.name || selectedProject?.name || "Lead Generation"}</h1>
            <div className="subtle">{status?.query || form.query}</div>
          </div>
          <div className="topbar-actions">
            <span className="subtle">{busy || (running ? "Running" : status?.state?.message || "Ready")}</span>
            <button className="ghost" onClick={() => setSimpleMode(true)}>
              <Search size={15} /> New search
            </button>
            <button
              className={`ghost ${selectedProject?.watchlist ? "watch-on" : ""}`}
              disabled={!selectedProject}
              onClick={() => toggleProjectWatch()}
              title={selectedProject?.watchlist ? "Remove project from watch list" : "Add project to watch list"}
            >
              <Star size={15} fill={selectedProject?.watchlist ? "currentColor" : "none"} />
              Watch
            </button>
            <button className="danger" disabled={!!busy || running || !selected} onClick={() => projectAction("delete")}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </header>

        {/* Mobile-only project switcher (the sidebar is hidden on small screens) */}
        {projects.length > 0 && (
          <div className="project-chips">
            {projects.map((p) => (
              <button
                key={p.slug}
                className={`chip-btn ${p.slug === selected ? "active" : ""}`}
                onClick={() => setSelected(p.slug)}
              >
                {p.running && <span className="run-dot" />}
                {p.watchlist && <Star size={13} fill="currentColor" />}
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="work">
          <section className="panel">
            <div className="form-grid compact-run-form">
              <div className="field">
                <label>Project</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label>Maps query</label>
                <input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} />
              </div>
              <div className="field">
                <label>Leads</label>
                <input value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
              </div>
            </div>
            {formRunning && <div className="form-note">“{form.name}” is already running. Change the project name to launch another in parallel.</div>}
            <div className="toolbar">
              <button className="primary" disabled={!!busy || formRunning} onClick={() => run(["scrape", "enrich", "whatsapp", "audit", "report"])}>
                <Play size={16} /> Run all
              </button>
              <button disabled={!!busy || formRunning} onClick={() => run(["scrape"])}>
                <Search size={16} /> Scrape
              </button>
              <button disabled={!!busy || formRunning} onClick={() => run(["enrich"])}>
                <Zap size={16} /> Enrich
              </button>
              <button disabled={!!busy || formRunning} onClick={() => run(["whatsapp"])}>
                <MessageCircle size={16} /> WhatsApp
              </button>
              <button disabled={!!busy || formRunning} onClick={() => run(["audit"])}>
                <BarChart3 size={16} /> Audit
              </button>
              <button disabled={!!busy || formRunning} onClick={() => run(["report"])}>
                <FileText size={16} /> Report
              </button>
              <button disabled={!!busy || running || !selected} onClick={() => projectAction("resume")}>
                <RotateCcw size={16} /> Resume
              </button>
              <button className="danger" disabled={!!busy || !running} onClick={() => projectAction("stop")}>
                <PauseCircle size={16} /> Stop
              </button>
              <button className="danger" disabled={!!busy || runningCount === 0} onClick={stopAllProjects} title="Stop every running project and any audit/Chrome processes still running in the background">
                <OctagonX size={16} /> Stop all{runningCount > 0 ? ` (${runningCount})` : ""}
              </button>
              <button disabled={!!busy || !selected} onClick={() => projectAction("cleanup")}>
                <Brush size={16} /> Clean browser
              </button>
              <button className="danger" disabled={!!busy || running || !selected} onClick={() => projectAction("delete")}>
                <Trash2 size={16} /> Delete
              </button>
              {status?.files?.report && (
                <a href={`${BASE_PATH}/api/projects/${encodeURIComponent(selected)}/report`} target="_blank">
                  <button>
                    <Globe2 size={16} /> Open report
                  </button>
                </a>
              )}
            </div>
          </section>

          <AccountsPanel
            accounts={accounts}
            onAdd={addAccount}
            onDelete={deleteAccount}
            onToggle={toggleAccount}
            busy={busy}
          />

          {error && <div className="panel empty">{error}</div>}

          <section className="stats">
            <div className="stat">
              <strong><AnimatedNumber value={status?.counts?.raw || 0} /></strong>
              <span className="subtle">Scraped leads</span>
            </div>
            <div className="stat">
              <strong><AnimatedNumber value={status?.counts?.websites || 0} /></strong>
              <span className="subtle">Websites</span>
            </div>
            <div className="stat">
              <strong><AnimatedNumber value={status?.counts?.enriched || 0} /></strong>
              <span className="subtle">Enriched rows</span>
            </div>
            <div className="stat">
              <strong><AnimatedNumber value={status?.counts?.desktopAudits || 0} /></strong>
              <span className="subtle">Desktop audits</span>
            </div>
            <div className="stat">
              <strong><AnimatedNumber value={status?.counts?.mobileAudits || 0} /></strong>
              <span className="subtle">Mobile audits</span>
            </div>
          </section>

          <section className="stage-grid">
            <Stage title="Scrape" stage={busy?.includes("scrape") && !stages.scrape ? { status: "starting" } : stages.scrape} />
            <Stage title="Enrich" stage={stages.enrich} />
            <Stage title="WhatsApp" stage={stages.whatsapp} />
            <Stage title="Desktop" stage={stages["audit-desktop"]} />
            <Stage title="Mobile" stage={stages["audit-mobile"]} />
            <Stage title="Report" stage={stages.report} />
          </section>

          <EnrichProgress progress={status?.enrichProgress} stage={stages.enrich} />

          <ScoreLegend />

          <section className="panel table-wrap captured-leads-table">
              {!leads.length ? (
                <div className="empty">No leads loaded</div>
              ) : (
                <>
                <div className="lead-cards only-mobile">
                  {leads.map((lead, index) => (
                    <div className="lead-card" key={`m-${lead.name}-${index}`}>
                      <div className="lead-card-head">
                        <strong>{lead.mapsUrl ? <a href={lead.mapsUrl} target="_blank" rel="noreferrer">{lead.name || "Unknown"}</a> : lead.name || "Unknown"}</strong>
                        <span className="subtle">{lead.category || ""}</span>
                      </div>
                      <div className="lead-card-row">
                        {lead.phone && <span>{lead.phone}</span>}
                        {lead.whatsappExists === "yes" && <span className="wa-badge">WA ✓</span>}
                        {lead.whatsappExists === "no" && <span className="wa-badge wa-no">WA ✗</span>}
                        {lead.website && <a href={lead.website} target="_blank">{lead.domain || "site"}</a>}
                      </div>
                      {lead.email && <div className="lead-card-row"><a href={`mailto:${lead.email}`}>{lead.email}</a></div>}
                      <div className="lead-card-row score-cell">
                        <Score label="Perf" value={lead.desktop?.performance} />
                        <Score label="SEO" value={lead.desktop?.seo} />
                        <Score label="M-Perf" value={lead.mobile?.performance} />
                      </div>
                      <div className="lead-card-row socials"><Socials lead={lead} /></div>
                      <div className="lead-card-row lead-row-actions">
                        <button className="ghost" onClick={() => addCapturedLead(lead, "watchlist")} title="Add to watch list">
                          <Star size={14} /> Watch
                        </button>
                        <button className="ghost" onClick={() => addCapturedLead(lead, "contact_list")} title="Add to custom list with notes">
                          <ListPlus size={14} /> List
                        </button>
                        <CapturedActions
                          lead={lead}
                          busy={rowBusy[leadKey(lead)] || {}}
                          onEnrich={enrichCaptured}
                          onWhatsapp={whatsappCaptured}
                          onReport={reportCaptured}
                          onRemove={hideCaptured}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <table className="only-desktop">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Website</th>
                      <th>Email</th>
                      <th>Socials</th>
                      <th>Desktop health</th>
                      <th>Mobile health</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, index) => (
                      <tr key={`${lead.name}-${index}`}>
                        <td className="name-cell">
                          {lead.mapsUrl ? (
                            <a href={lead.mapsUrl} target="_blank" rel="noreferrer">
                              {lead.name || "Unknown"}
                            </a>
                          ) : (
                            lead.name || "Unknown"
                          )}
                          <br />
                          <span className="subtle">{lead.category || lead.address || ""}</span>
                        </td>
                        <td>
                          {lead.phone || "-"}
                          {lead.whatsappExists === "yes" && (
                            <>
                              {" "}
                              <span className="wa-badge" title={lead.whatsappId || "On WhatsApp"}>WA ✓</span>
                            </>
                          )}
                          {lead.whatsappExists === "no" && (
                            <>
                              {" "}
                              <span className="wa-badge wa-no" title="Not on WhatsApp">WA ✗</span>
                            </>
                          )}
                          <br />
                          <span className="subtle">{lead.rating ? `Rating ${lead.rating}` : ""}</span>
                        </td>
                        <td>
                          {lead.website ? (
                            <a href={lead.website} target="_blank">
                              {lead.domain || lead.website}
                            </a>
                          ) : (
                            <span className="subtle">No website</span>
                          )}
                        </td>
                        <td>{lead.email || <span className="subtle">{lead.enrichStatus || "-"}</span>}</td>
                        <td className="socials">
                          <Socials lead={lead} />
                        </td>
                        <td className="score-cell">
                          <Score label="Perf" value={lead.desktop?.performance} />
                          <Score label="SEO" value={lead.desktop?.seo} />
                        </td>
                        <td className="score-cell">
                          <Score label="Perf" value={lead.mobile?.performance} />
                          <Score label="SEO" value={lead.mobile?.seo} />
                        </td>
                        <td>
                          <div className="lead-row-actions">
                            <button className="ghost" onClick={() => addCapturedLead(lead, "watchlist")} title="Add to watch list">
                              <Star size={14} /> Watch
                            </button>
                            <button className="ghost" onClick={() => addCapturedLead(lead, "contact_list")} title="Add to custom list with notes">
                              <ListPlus size={14} /> List
                            </button>
                            <CapturedActions
                              lead={lead}
                              busy={rowBusy[leadKey(lead)] || {}}
                              onEnrich={enrichCaptured}
                              onWhatsapp={whatsappCaptured}
                              onReport={reportCaptured}
                              onRemove={hideCaptured}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
          </section>
        </div>
      </section>
      <MobileNav active="projects" />
      {reportLead && <ReportModal lead={reportLead} onClose={() => setReportLead(null)} />}
    </main>
  );
}
