"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Brush,
  Database,
  FileText,
  Globe2,
  KeyRound,
  MessageCircle,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
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
    <section className="panel accounts">
      <div className="accounts-head">
        <KeyRound size={16} />
        <strong>Gmail accounts</strong>
        <span className="subtle">
          {accounts.length ? `${accounts.filter((a) => a.enabled).length}/${accounts.length} active · auto-rotated per scrape` : "none yet — scrapes run logged out"}
        </span>
      </div>
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
    </section>
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
      setStatus(data);
      if (syncForm) {
        setForm((old) => ({ ...old, name: data.name || old.name, query: data.query || old.query, max: data.max || old.max }));
      }
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    loadProjects().catch((err) => setError(err.message));
    loadAccounts().catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus(selected, true).catch(() => {}); // switching project: populate the form once
    const id = setInterval(() => {
      loadProjects().catch(() => {});
      loadStatus(selected, false).catch(() => {}); // polling: refresh status only, leave the form alone
    }, 1500);
    return () => clearInterval(id);
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

  const stages = status?.state?.stages || {};
  const leads = status?.leads || [];
  const running = !!status?.state?.activeAlive;
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
            <Database size={15} /> All leads
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
                  {project.name}
                </strong>
                <br />
                <span className="subtle">
                  {project.counts?.raw || 0} leads | {project.counts?.desktopAudits || 0}/{project.counts?.mobileAudits || 0} audits
                </span>
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
          <div className="subtle">{busy || (running ? "Running" : status?.state?.message || "Ready")}</div>
        </header>

        <div className="work">
          <AccountsPanel
            accounts={accounts}
            onAdd={addAccount}
            onDelete={deleteAccount}
            onToggle={toggleAccount}
            busy={busy}
          />

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
                <label className="check" title="Skip rendering the map pane (disables GPU/WebGL/2D canvas). Saves CPU/GPU; the lead feed and capture are unaffected.">
                  <input
                    type="checkbox"
                    checked={!!form.blockCanvas}
                    onChange={(e) => setForm({ ...form, blockCanvas: e.target.checked })}
                  />
                  Block canvas
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
                <table>
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
              )}
            </div>
            <div className="panel">
              <div className="mono-log">{status?.logs || "Waiting for activity..."}</div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
