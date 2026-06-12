"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MobileNav from "./components/MobileNav";
import {
  BarChart3,
  Bot,
  Brush,
  Database,
  FileText,
  Globe2,
  KeyRound,
  MessageCircle,
  PauseCircle,
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
    <span className={`score-pill ${scoreClass(value)}`} title={`${label}: ${value}/100 (Google Lighthouse)`}>
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

// A plain-language legend so the numbers aren't cryptic. Shown above the table.
function ScoreLegend() {
  return (
    <div className="legend">
      <strong>Website health</strong> — Google Lighthouse score (0–100, higher is better). Perf = page speed, SEO = search readiness.
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
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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
    loadProjects().catch((err) => setError(err.message));
    loadAccounts().catch(() => {});
  }, []);

  useEffect(() => {
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
  }, [selected]);

  async function run(stages) {
    setBusy(`Starting ${stages.join(", ")}`);
    setError("");
    try {
      const data = await jsonFetch("/api/projects/run", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          stages,
          enrichConcurrency: Number(form.enrichConcurrency || 16),
          auditConcurrency: Number(form.auditConcurrency || 2),
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

  const stages = status?.state?.stages || {};
  const leads = status?.leads || [];
  // Trust either source: the projects list (authoritative, refreshed every tick)
  // or the selected project's status. This keeps the Stop button enabled even
  // when a status fetch is mid-flight or briefly stale after switching projects.
  const running = !!status?.state?.activeAlive || !!selectedProject?.running;
  const runningCount = projects.filter((p) => p.running).length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={22} />
          <span>Lead Ops</span>
        </div>
        <nav className="nav">
          <span className="nav-link active">Projects</span>
          <Link className="nav-link" href="/leads">
            <Database size={15} /> Leads
          </Link>
          <Link className="nav-link" href="/agent">
            <Bot size={15} /> Agent
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
                  {project.counts?.raw || 0} leads | {project.counts?.desktopAudits || 0}/{project.counts?.mobileAudits || 0} audits
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
            <div className="form-grid">
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
              <div className="field">
                <label>Enrich speed</label>
                <input value={form.enrichConcurrency} onChange={(e) => setForm({ ...form, enrichConcurrency: e.target.value })} />
              </div>
              <div className="field">
                <label>Audit workers</label>
                <input value={form.auditConcurrency} onChange={(e) => setForm({ ...form, auditConcurrency: e.target.value })} />
              </div>
              <div className="field">
                <label>Scrape mode</label>
                <label className="check" title="Read leads off the Maps network responses (fast). Uncheck for the slower, more resilient click-each-card mode.">
                  <input
                    type="checkbox"
                    checked={!!form.network}
                    onChange={(e) => setForm({ ...form, network: e.target.checked })}
                  />
                  Fast network mode
                </label>
                <label className="check" title="Run Chrome with no visible window. Lighter, and required on servers without a display.">
                  <input
                    type="checkbox"
                    checked={!!form.headless}
                    onChange={(e) => setForm({ ...form, headless: e.target.checked })}
                  />
                  Headless
                </label>
                <label className="check" title="Stop the map pane from painting at all (canvas getContext is stubbed out + tile downloads blocked). Big CPU saving; the lead feed and capture are unaffected.">
                  <input
                    type="checkbox"
                    checked={!!form.blockCanvas}
                    onChange={(e) => setForm({ ...form, blockCanvas: e.target.checked })}
                  />
                  Block canvas
                </label>
                <label className="check" title="Skip downloading images, media and fonts. Lighter and faster; lead photos still come through as URLs in the CSV.">
                  <input
                    type="checkbox"
                    checked={!!form.blockImages}
                    onChange={(e) => setForm({ ...form, blockImages: e.target.checked })}
                  />
                  Block images
                </label>
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
                <BarChart3 size={16} /> Lighthouse
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
              <button className="danger" disabled={!!busy || runningCount === 0} onClick={stopAllProjects} title="Stop every running project and any Lighthouse/Chrome processes still running in the background">
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
              <strong>{status?.counts?.raw || 0}</strong>
              <span className="subtle">Scraped leads</span>
            </div>
            <div className="stat">
              <strong>{status?.counts?.websites || 0}</strong>
              <span className="subtle">Websites</span>
            </div>
            <div className="stat">
              <strong>{status?.counts?.enriched || 0}</strong>
              <span className="subtle">Enriched rows</span>
            </div>
            <div className="stat">
              <strong>{status?.counts?.desktopAudits || 0}</strong>
              <span className="subtle">Desktop audits</span>
            </div>
            <div className="stat">
              <strong>{status?.counts?.mobileAudits || 0}</strong>
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

          <ScoreLegend />

          <section className="split">
            <div className="panel table-wrap">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
            </div>
            <div className="panel">
              <div className="mono-log">{status?.logs || "Waiting for activity..."}</div>
            </div>
          </section>
        </div>
      </section>
      <MobileNav active="projects" />
    </main>
  );
}
