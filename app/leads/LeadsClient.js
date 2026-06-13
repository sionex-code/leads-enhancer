"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import MobileNav from "../components/MobileNav";
import AnimatedNumber from "../components/AnimatedNumber";
import ReportModal from "../components/ReportModal";
import useSidebarCollapse from "../components/useSidebarCollapse";
import {
  Ban,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  Loader2,
  ListPlus,
  Mail,
  MailCheck,
  MapPin,
  MessageCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Search,
  Send,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const PAGE_SIZE = 120;

const WORKFLOWS = [
  { key: "", label: "All" },
  { key: "needs-action", label: "Needs action" },
  { key: "watchlist", label: "Watch" },
  { key: "contacts", label: "Custom list" },
  { key: "email-ready", label: "Email ready" },
  { key: "queued", label: "Queued" },
  { key: "sent", label: "Sent" },
  { key: "complete", label: "Complete" },
];

const EMAIL_STATUS = {
  unset: "Unset",
  send: "Send email",
  do_not_send: "Do not email",
  later: "Later",
};

const OUTREACH_STATUS = {
  new: "New",
  queued: "Queued",
  sent: "Sent",
  complete: "Complete",
  skipped: "Skipped",
};

// whatsapp_status holds the descriptive outcome from the checker ("on whatsapp",
// "not on whatsapp", "no phone", "error: ...") — normalize it to a badge state.
function waState(lead) {
  const s = String(lead.whatsapp_status || "").toLowerCase();
  if (!s) return null;
  if (s === "yes" || s.startsWith("on whatsapp")) return "yes";
  if (s === "no" || s.startsWith("not on whatsapp")) return "no";
  return "other"; // no phone / pending / error
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

function scoreClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n >= 90) return "good";
  if (n >= 50) return "avg";
  return "poor";
}

function Score({ label, value }) {
  if (value === "" || value === null || value === undefined) return <span className="score-pill empty">{label} -</span>;
  return (
    <span className={`score-pill ${scoreClass(value)}`} title={`${label}: ${value}/100`}>
      {label} {value}
    </span>
  );
}

function WorkflowBadge({ lead }) {
  const status = lead.outreach_status || "new";
  const cls = status === "complete" ? "good" : status === "sent" ? "sent" : status === "queued" ? "avg" : status === "skipped" ? "muted" : "";
  return <span className={`workflow-badge ${cls}`}>{OUTREACH_STATUS[status] || status}</span>;
}

function EmailBadge({ status }) {
  const value = status || "unset";
  const cls = value === "send" ? "good" : value === "do_not_send" ? "bad" : value === "later" ? "avg" : "muted";
  return <span className={`workflow-badge ${cls}`}>{EMAIL_STATUS[value] || value}</span>;
}

const SOCIAL_FIELDS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["linkedin", "LinkedIn"],
  ["twitter", "X / Twitter"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
  ["pinterest", "Pinterest"],
  ["whatsapp", "WhatsApp"],
  ["telegram", "Telegram"],
];

function Socials({ lead, full = false }) {
  const present = SOCIAL_FIELDS.filter(([key]) => lead[key]);
  if (!present.length) return <span className="subtle">-</span>;
  return (
    <>
      {present.map(([key, label]) => (
        <a key={key} href={lead[key]} target="_blank" rel="noreferrer" title={lead[key]} className={full ? "chip-link" : ""}>
          {full ? label : label.slice(0, 2).toUpperCase()}
        </a>
      ))}
    </>
  );
}

function QuickLeadActions({ lead, onPatch, compact = false }) {
  const busy = false;
  const iconSize = compact ? 14 : 15;
  return (
    <div className={compact ? "quick-actions compact" : "quick-actions"} onClick={(e) => e.stopPropagation()}>
      <button
        className={`ghost ${lead.watchlist ? "watch-on" : ""}`}
        disabled={busy}
        onClick={() => onPatch(lead.id, { watchlist: !lead.watchlist })}
        title={lead.watchlist ? "Remove from watch list" : "Add to watch list"}
      >
        <Star size={iconSize} fill={lead.watchlist ? "currentColor" : "none"} />
        {!compact && "Watch"}
      </button>
      <button
        className={`ghost ${lead.contact_list ? "contact-on" : ""}`}
        disabled={busy}
        onClick={() => onPatch(lead.id, { contact_list: !lead.contact_list })}
        title={lead.contact_list ? "Remove from custom list" : "Add to custom list"}
      >
        <ListPlus size={iconSize} />
        {!compact && "List"}
      </button>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => onPatch(lead.id, { email_status: lead.email_status === "send" ? "unset" : "send", contact_list: true })}
        title="Toggle send email"
      >
        <MailCheck size={iconSize} />
        {!compact && "Email"}
      </button>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => onPatch(lead.id, { outreach_status: "sent", contact_list: true })}
        title="Mark message sent"
      >
        <Send size={iconSize} />
        {!compact && "Sent"}
      </button>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => onPatch(lead.id, { outreach_status: "complete", contact_list: true })}
        title="Mark complete"
      >
        <CheckCircle2 size={iconSize} />
        {!compact && "Done"}
      </button>
    </div>
  );
}

// Inline per-row contact actions: grab email/socials, check WhatsApp, open the
// website report, and remove. Remove is context-aware (see removeLead in parent):
// in a watch/custom-list view it just drops the lead from that view; in the full
// leads view it deletes permanently.
function RowActions({ lead, busy = {}, onEnrich, onWhatsapp, onReport, onRemove, removeTitle }) {
  const wa = waState(lead);
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      <button
        className="ghost"
        title={lead.email ? "Re-grab email + socials" : "Grab email + socials"}
        disabled={!lead.website || busy.enrich}
        onClick={() => onEnrich(lead)}
      >
        {busy.enrich ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}
      </button>
      <button
        className={`ghost ${wa === "yes" ? "watch-on" : ""}`}
        title={lead.phone ? (wa ? `WhatsApp: ${lead.whatsapp_status}` : "Check WhatsApp") : "No phone to check"}
        disabled={!lead.phone || busy.whatsapp}
        onClick={() => onWhatsapp(lead)}
      >
        {busy.whatsapp ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />}
      </button>
      <button className="ghost" title="Website report" disabled={!lead.website} onClick={() => onReport(lead)}>
        <FileText size={14} />
      </button>
      <button className="ghost danger-ghost" title={removeTitle} disabled={busy.remove} onClick={() => onRemove(lead)}>
        {busy.remove ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
      </button>
    </div>
  );
}

function LeadDrawer({ lead, onClose, onDeleted, onPatch }) {
  const [reports, setReports] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);
  const pollRef = useRef(null);

  const loadReports = useCallback(async () => {
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/report`);
      setReports(data.reports || []);
    } catch {}
  }, [lead.id]);

  useEffect(() => {
    setReports([]);
    setJob(null);
    setError("");
    setNotes(lead.notes || "");
    loadReports();
    return () => clearTimeout(pollRef.current);
  }, [lead.id, lead.notes, loadReports]);

  async function pollJob(jobId) {
    try {
      const data = await jsonFetch(`/api/agent/jobs/${jobId}`);
      setJob({ id: jobId, ...data });
      if (data.status === "running") {
        pollRef.current = setTimeout(() => pollJob(jobId), 2500);
      } else {
        loadReports();
      }
    } catch {
      pollRef.current = setTimeout(() => pollJob(jobId), 4000);
    }
  }

  async function patch(patchBody) {
    setSaving(true);
    setError("");
    try {
      await onPatch(lead.id, patchBody);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    await patch({ notes });
  }

  async function generate() {
    setError("");
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/report`, { method: "POST" });
      setJob({ id: data.jobId, status: "running", log: [] });
      pollJob(data.jobId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelJob() {
    if (!job?.id) return;
    try {
      await jsonFetch(`/api/agent/jobs/${job.id}`, { method: "DELETE" });
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${lead.name || "this lead"}" from the database? This is permanent.`)) return;
    try {
      await jsonFetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      onDeleted(lead.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const generating = job?.status === "running";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer lead-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{lead.name || "Unknown"}</h2>
            <div className="lead-meta-line">
              <WorkflowBadge lead={lead} />
              <EmailBadge status={lead.email_status} />
              {lead.watchlist ? <span className="workflow-badge watch"><Star size={12} fill="currentColor" /> Watch</span> : null}
              {lead.contact_list ? <span className="workflow-badge contact"><Users size={12} /> List</span> : null}
            </div>
          </div>
          <button className="icon" onClick={onClose} title="Close"><X size={17} /></button>
        </header>

        <div className="drawer-body">
          <section className="drawer-card workflow-card">
            <h3>Workflow</h3>
            <div className="workflow-grid">
              <button className={lead.watchlist ? "toggle-card on" : "toggle-card"} onClick={() => patch({ watchlist: !lead.watchlist })}>
                <Star size={16} fill={lead.watchlist ? "currentColor" : "none"} />
                <span>Watch list</span>
              </button>
              <button className={lead.contact_list ? "toggle-card on" : "toggle-card"} onClick={() => patch({ contact_list: !lead.contact_list })}>
                <ListPlus size={16} />
                <span>Custom list</span>
              </button>
            </div>
            <div className="drawer-field-grid">
              <label className="field">
                <span>Email decision</span>
                <select value={lead.email_status || "unset"} onChange={(e) => patch({ email_status: e.target.value })}>
                  {Object.entries(EMAIL_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Outreach status</span>
                <select value={lead.outreach_status || "new"} onChange={(e) => patch({ outreach_status: e.target.value, contact_list: e.target.value !== "new" })}>
                  {Object.entries(OUTREACH_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
            <textarea
              className="notes-box"
              placeholder="Notes about outreach, objection, next step, owner, or email copy..."
              value={notes}
              rows={5}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="drawer-actions">
              <button className="primary" disabled={saving} onClick={saveNotes}>
                <MessageSquare size={15} /> Save notes
              </button>
              <button disabled={saving} onClick={() => patch({ outreach_status: "sent", contact_list: true })}>
                <Send size={15} /> Mark sent
              </button>
              <button disabled={saving} onClick={() => patch({ outreach_status: "complete", contact_list: true })}>
                <CheckCircle2 size={15} /> Complete
              </button>
              <button disabled={saving} onClick={() => patch({ outreach_status: "skipped", email_status: "do_not_send" })}>
                <Ban size={15} /> Skip
              </button>
            </div>
          </section>

          <section className="drawer-card">
            <h3>Contact</h3>
            <div className="drawer-rows">
              {lead.phone && <div><Phone size={13} /> {lead.phone} {waState(lead) === "yes" && <span className="wa-badge">WA yes</span>}{waState(lead) === "no" && <span className="wa-badge wa-no">WA no</span>}</div>}
              {lead.email && <div><Mail size={13} /> <a href={`mailto:${lead.email}`}>{lead.email}</a></div>}
              {lead.all_emails && lead.all_emails !== lead.email && <div className="subtle">Also: {lead.all_emails}</div>}
              {lead.address && <div><MapPin size={13} /> {lead.address}</div>}
              {lead.website && (
                <div><ExternalLink size={13} /> <a href={lead.website} target="_blank" rel="noreferrer">{lead.domain || lead.website}</a></div>
              )}
              {lead.maps_url && <div><a href={lead.maps_url} target="_blank" rel="noreferrer">Open on Google Maps</a></div>}
            </div>
          </section>

          <section className="drawer-card">
            <h3>Socials</h3>
            <div className="chips"><Socials lead={lead} full /></div>
          </section>

          <section className="drawer-card">
            <h3>Website health</h3>
            <div className="drawer-scores">
              <div>
                <span className="subtle">Desktop</span>
                <Score label="Perf" value={lead.desktop_performance} />
                <Score label="SEO" value={lead.desktop_seo} />
                <Score label="A11y" value={lead.desktop_accessibility} />
              </div>
              <div>
                <span className="subtle">Mobile</span>
                <Score label="Perf" value={lead.mobile_performance} />
                <Score label="SEO" value={lead.mobile_seo} />
                <Score label="A11y" value={lead.mobile_accessibility} />
              </div>
            </div>
          </section>

          <section className="drawer-card">
            <h3>Independent report</h3>
            <p className="subtle">Fast real-Chrome audit (desktop + mobile): speed, layout, mobile, SEO, security, support-chat — summarized by AI, with the raw report attached.</p>
            {reports.map((r) => (
              <a key={r.file} className="report-link" href={`${BASE_PATH}/api/agent/reports/${r.file}`} target="_blank" rel="noreferrer">
                <FileText size={14} /> {r.file} <span className="subtle">{new Date(r.createdAt).toLocaleString()}</span>
              </a>
            ))}
            {generating && (
              <div className="job-progress">
                <Loader2 size={14} className="spin" /> {job.cancelRequested ? "Stopping..." : "Generating..."}
                <button className="job-stop" onClick={cancelJob} title="Stop this report job" disabled={!!job.cancelRequested}>Stop</button>
                <div className="subtle">{(job.log || []).slice(-2).join(" | ")}</div>
              </div>
            )}
            {job?.status === "failed" && <div className="chat-error">Report failed: {job.error}</div>}
            {job?.status === "cancelled" && <div className="subtle">Report job cancelled.</div>}
            {error && <div className="chat-error">{error}</div>}
            <div className="drawer-actions">
              <button className="primary" disabled={!lead.website || generating} onClick={generate}>
                <FileText size={15} /> {reports.length ? "Regenerate report" : "Generate report"}
              </button>
              <button className="danger" onClick={remove}><Trash2 size={15} /> Delete lead</button>
            </div>
            {!lead.website && <div className="subtle">No website on this lead. Reports need a website.</div>}
          </section>

          <section className="drawer-card">
            <h3>Meta</h3>
            <div className="drawer-rows subtle">
              <div>Project: {lead.project || "-"}</div>
              <div>Query: {lead.query || "-"}</div>
              {lead.hours && <div>Hours: {lead.hours}</div>}
              <div>First seen: {lead.first_seen?.slice(0, 10)} | Updated: {lead.last_updated?.slice(0, 10)}</div>
              {lead.message_sent_at && <div>Sent: {new Date(lead.message_sent_at).toLocaleString()}</div>}
              {lead.completed_at && <div>Completed: {new Date(lead.completed_at).toLocaleString()}</div>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function LeadsPage({ initialWorkflow = "", pageTitle = "Lead manager", activeNav = "leads" }) {
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapse();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [countries, setCountries] = useState([]);
  const [cities, setCities] = useState([]);
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [hasEmail, setHasEmail] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [reportLead, setReportLead] = useState(null);
  const [busy, setBusy] = useState({});
  const [manualSite, setManualSite] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [adding, setAdding] = useState("");

  const mergeLead = useCallback((lead) => {
    setRows((current) => current.map((row) => (row.id === lead.id ? lead : row)));
    setActive((current) => (current?.id === lead.id ? lead : current));
  }, []);

  const patchLead = useCallback(async (id, patch) => {
    const data = await jsonFetch(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (data.lead) mergeLead(data.lead);
    return data.lead;
  }, [mergeLead]);

  const setBusyKey = useCallback((key, val) => {
    setBusy((b) => ({ ...b, [key]: val }));
  }, []);

  const enrichOne = useCallback(async (lead) => {
    const key = `${lead.id}:enrich`;
    setBusyKey(key, true);
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/enrich`, { method: "POST" });
      if (data.lead) mergeLead(data.lead);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyKey(key, false);
    }
  }, [mergeLead, setBusyKey]);

  const checkWhatsapp = useCallback(async (lead) => {
    const key = `${lead.id}:whatsapp`;
    setBusyKey(key, true);
    try {
      const qs = country ? `?country=${encodeURIComponent(country)}` : "";
      const data = await jsonFetch(`/api/leads/${lead.id}/whatsapp${qs}`, { method: "POST" });
      if (data.lead) mergeLead(data.lead);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyKey(key, false);
    }
  }, [country, mergeLead, setBusyKey]);

  // Context-aware remove: in a watch/custom-list view drop the lead from that
  // list only (it stays in the full leads database); in the full view delete it.
  const removeLead = useCallback(async (lead) => {
    if (workflow === "watchlist" || workflow === "contacts") {
      const field = workflow === "watchlist" ? "watchlist" : "contact_list";
      await patchLead(lead.id, { [field]: false });
      setRows((r) => r.filter((x) => x.id !== lead.id));
      if (active?.id === lead.id) setActive(null);
      return;
    }
    if (!confirm(`Delete "${lead.name || "this lead"}" from the database? This is permanent and removes it from every view.`)) return;
    const key = `${lead.id}:remove`;
    setBusyKey(key, true);
    try {
      await jsonFetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      setRows((r) => r.filter((x) => x.id !== lead.id));
      if (active?.id === lead.id) setActive(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyKey(key, false);
    }
  }, [workflow, patchLead, active?.id, setBusyKey]);

  const removeTitle = workflow === "watchlist"
    ? "Remove from watch list"
    : workflow === "contacts"
      ? "Remove from custom list"
      : "Delete lead permanently";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (project) params.set("project", project);
      if (country) params.set("country", country);
      if (city) params.set("city", city);
      if (workflow) params.set("workflow", workflow);
      if (hasEmail) params.set("hasEmail", "1");
      if (minScore) params.set("minScore", String(minScore));
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      const data = await jsonFetch(`/api/leads?${params.toString()}`);
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setStats(data.stats || null);
      setProjects(data.projects || []);
      setCountries(data.countries || []);
      setCities(data.cities || []);
      if (active?.id) {
        const next = (data.rows || []).find((row) => row.id === active.id);
        if (next) setActive(next);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [active?.id, city, country, hasEmail, minScore, page, project, search, workflow]);

  useEffect(() => {
    setPage(0);
  }, [city, country, hasEmail, initialWorkflow, minScore, project, search, workflow]);

  useEffect(() => {
    setWorkflow(initialWorkflow);
  }, [initialWorkflow]);

  async function addManualLead(target) {
    const website = manualSite.trim();
    if (!website || adding) return;
    setAdding(target);
    try {
      const data = await jsonFetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          website,
          name: manualName.trim(),
          notes: manualNotes.trim(),
          watchlist: target === "watchlist",
          contact_list: target === "contact_list",
        }),
      });
      setManualSite("");
      setManualName("");
      setManualNotes("");
      if (data.lead) setActive(data.lead);
      setPage(0);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding("");
    }
  }

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const statTiles = [
    ["Total", stats?.total || 0],
    ["Watch", stats?.watchlist || 0],
    ["Custom list", stats?.contactList || 0],
    ["Email ready", stats?.emailReady || 0],
    ["Queued", stats?.queued || 0],
    ["Sent", stats?.sent || 0],
    ["Done", stats?.completed || 0],
  ];
  const pageStart = total && rows.length ? page * PAGE_SIZE + 1 : 0;
  const pageEnd = total && rows.length ? page * PAGE_SIZE + rows.length : 0;
  const hasNextPage = rows.length > 0 && pageEnd < total;

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
          <Link className="nav-link" href="/" title="Projects">
            <FolderOpen size={15} /> <span className="nav-text">Projects</span>
          </Link>
          <Link className={`nav-link ${activeNav === "leads" ? "active" : ""}`} href="/leads" title="Leads">
            <Database size={15} /> <span className="nav-text">Leads</span>
          </Link>
          <Link className={`nav-link ${activeNav === "watchlist" ? "active" : ""}`} href="/watchlist" title="Watch list">
            <Star size={15} /> <span className="nav-text">Watch</span>
          </Link>
          <Link className="nav-link" href="/agent" title="Agent"><Bot size={15} /> <span className="nav-text">Agent</span></Link>
        </nav>
        {stats && (
          <div className="db-stats crm-stats">
            {statTiles.map(([label, value]) => (
              <button key={label} className="stat-mini" onClick={() => {
                if (label === "Watch") setWorkflow("watchlist");
                if (label === "Custom list") setWorkflow("contacts");
                if (label === "Email ready") setWorkflow("email-ready");
                if (label === "Queued") setWorkflow("queued");
                if (label === "Sent") setWorkflow("sent");
                if (label === "Done") setWorkflow("complete");
                if (label === "Total") setWorkflow("");
              }}>
                <strong><AnimatedNumber value={value} /></strong>
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="project-main">
        <header className="topbar lead-topbar">
          <div>
            <h1>{pageTitle}</h1>
            <div className="subtle">
              <AnimatedNumber value={total} /> lead{total === 1 ? "" : "s"} match. Manage watch lists, custom lists, email intent, outreach status, and notes.
            </div>
          </div>
          <div className="topbar-actions">
            <a href={`${BASE_PATH}/api/leads/export`}>
              <button className="primary"><Download size={16} /> Export CSV</button>
            </a>
          </div>
        </header>

        <div className="work leads-work">
          <section className="panel crm-toolbar">
            <div className="manual-add-row">
              <div className="field search-field manual-site">
                <Globe2 size={15} />
                <input
                  placeholder="Add single site or domain..."
                  value={manualSite}
                  onChange={(e) => setManualSite(e.target.value)}
                />
              </div>
              <input
                className="manual-name"
                placeholder="Lead name"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
              <input
                className="manual-notes"
                placeholder="Notes"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
              />
              <button disabled={!manualSite.trim() || !!adding} onClick={() => addManualLead("watchlist")}>
                <Star size={15} /> Watch
              </button>
              <button className="primary" disabled={!manualSite.trim() || !!adding} onClick={() => addManualLead("contact_list")}>
                <ListPlus size={15} /> List
              </button>
            </div>
            <div className="workflow-tabs">
              {WORKFLOWS.map((item) => (
                <button key={item.key || "all"} className={workflow === item.key ? "active" : ""} onClick={() => setWorkflow(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="filters lead-filters">
              <div className="field search-field">
                <Search size={15} />
                <input placeholder="Search name, domain, phone, email, category, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label className="filter-select">
                Project
                <select value={project} onChange={(e) => setProject(e.target.value)}>
                  <option value="">All projects</option>
                  {projects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="filter-select">
                Country
                <select value={country} onChange={(e) => { setCountry(e.target.value); setCity(""); }}>
                  <option value="">All countries</option>
                  {countries.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                </select>
              </label>
              <label className="filter-select">
                City
                <select value={city} onChange={(e) => setCity(e.target.value)}>
                  <option value="">All cities</option>
                  {cities.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} /> Has email
              </label>
              <label className="filter-select">
                Min perf
                <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
                  <option value={0}>Any</option>
                  <option value={50}>50+</option>
                  <option value={90}>90+</option>
                </select>
              </label>
              <span className="subtle">
                {loading ? "Loading..." : total ? `${pageStart}-${pageEnd} of ${total}` : "0 shown"}
              </span>
            </div>
          </section>

          <div className="panel table-wrap tall leads-table">
            {!rows.length ? (
              <div className="empty">{loading ? "Loading..." : "No leads match this view."}</div>
            ) : (
              <>
                <div className="lead-cards only-mobile">
                  {rows.map((lead) => (
                    <div className="lead-card tappable crm-lead-card" key={`m-${lead.id}`} onClick={() => setActive(lead)}>
                      <div className="lead-card-head">
                        <strong>{lead.name || "Unknown"}</strong>
                        <span className="subtle">{lead.category || lead.address || lead.project || ""}</span>
                      </div>
                      <div className="lead-meta-line">
                        <WorkflowBadge lead={lead} />
                        <EmailBadge status={lead.email_status} />
                        {lead.watchlist ? <span className="workflow-badge watch"><Star size={12} fill="currentColor" /> Watch</span> : null}
                      </div>
                      <div className="lead-card-row">
                        {lead.phone && <span>{lead.phone}</span>}
                        {waState(lead) === "yes" && <span className="wa-badge">WA yes</span>}
                        {lead.domain && <span className="subtle">{lead.domain}</span>}
                      </div>
                      {lead.email && <div className="lead-card-row email-row">{lead.email}</div>}
                      {lead.notes && <div className="lead-note-preview">{lead.notes}</div>}
                      <QuickLeadActions lead={lead} onPatch={patchLead} compact />
                      <RowActions
                        lead={lead}
                        busy={{
                          enrich: busy[`${lead.id}:enrich`],
                          whatsapp: busy[`${lead.id}:whatsapp`],
                          remove: busy[`${lead.id}:remove`],
                        }}
                        onEnrich={enrichOne}
                        onWhatsapp={checkWhatsapp}
                        onReport={setReportLead}
                        onRemove={removeLead}
                        removeTitle={removeTitle}
                      />
                    </div>
                  ))}
                </div>
                <table className="only-desktop crm-table">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Contact</th>
                      <th>Workflow</th>
                      <th>Email</th>
                      <th>Website</th>
                      <th>Health</th>
                      <th>Location</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((lead) => (
                      <tr key={lead.id} className="row-click" onClick={() => setActive(lead)}>
                        <td className="name-cell">
                          {lead.name || "Unknown"}
                          <br />
                          <span className="subtle">{lead.category || lead.address || ""}</span>
                          {lead.notes && <div className="lead-note-preview">{lead.notes}</div>}
                        </td>
                        <td>
                          {lead.phone || "-"}
                          {waState(lead) === "yes" && <> <span className="wa-badge">WA yes</span></>}
                          {waState(lead) === "no" && <> <span className="wa-badge wa-no">WA no</span></>}
                          <br />
                          {lead.email ? <a onClick={(e) => e.stopPropagation()} href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="subtle">{lead.enrich_status || "no email"}</span>}
                        </td>
                        <td>
                          <div className="lead-meta-line">
                            <WorkflowBadge lead={lead} />
                            {lead.watchlist ? <span className="workflow-badge watch"><Star size={12} fill="currentColor" /> Watch</span> : null}
                            {lead.contact_list ? <span className="workflow-badge contact"><Users size={12} /> List</span> : null}
                          </div>
                        </td>
                        <td><EmailBadge status={lead.email_status} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {lead.website ? (
                            <a href={lead.website} target="_blank" rel="noreferrer">{lead.domain || lead.website}</a>
                          ) : (
                            <span className="subtle">none</span>
                          )}
                          <div className="socials"><Socials lead={lead} /></div>
                        </td>
                        <td className="score-cell">
                          <Score label="D" value={lead.desktop_performance} />
                          <Score label="M" value={lead.mobile_performance} />
                          <Score label="SEO" value={lead.desktop_seo || lead.mobile_seo} />
                        </td>
                        <td className="subtle">
                          {lead.city || "-"}
                          {lead.country ? <><br /><span className="subtle">{lead.country}</span></> : null}
                        </td>
                        <td>
                          <QuickLeadActions lead={lead} onPatch={patchLead} compact />
                          <RowActions
                            lead={lead}
                            busy={{
                              enrich: busy[`${lead.id}:enrich`],
                              whatsapp: busy[`${lead.id}:whatsapp`],
                              remove: busy[`${lead.id}:remove`],
                            }}
                            onEnrich={enrichOne}
                            onWhatsapp={checkWhatsapp}
                            onReport={setReportLead}
                            onRemove={removeLead}
                            removeTitle={removeTitle}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
          <div className="lead-pager">
            <button disabled={loading || page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>
              Previous
            </button>
            <span className="subtle">
              {total ? `${pageStart}-${pageEnd} of ${total}` : "0 leads"}
            </span>
            <button disabled={loading || !hasNextPage} onClick={() => setPage((n) => n + 1)}>
              Next
            </button>
          </div>
        </div>
      </section>

      <MobileNav active={activeNav} />
      {reportLead && <ReportModal lead={reportLead} onClose={() => setReportLead(null)} />}
      {active && (
        <LeadDrawer
          lead={active}
          onClose={() => setActive(null)}
          onPatch={patchLead}
          onDeleted={(id) => {
            setActive(null);
            setRows((r) => r.filter((x) => x.id !== id));
          }}
        />
      )}
    </main>
  );
}
