"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Database, Download, ExternalLink, FileText, Loader2, MapPin, Phone, Mail, Search, ShieldCheck, Trash2, X } from "lucide-react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

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
  if (value === "" || value === null || value === undefined) return <span className="score-pill empty">{label} —</span>;
  return (
    <span className={`score-pill ${scoreClass(value)}`} title={`${label}: ${value}/100`}>
      {label} {value}
    </span>
  );
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
        <a key={key} href={lead[key]} target="_blank" title={lead[key]} className={full ? "chip-link" : ""}>
          {full ? label : label.slice(0, 2).toUpperCase()}
        </a>
      ))}
    </>
  );
}

// ---- per-lead drawer: full detail + independent report + delete ----------------
function LeadDrawer({ lead, onClose, onDeleted }) {
  const [reports, setReports] = useState([]);
  const [job, setJob] = useState(null); // {id, status, log}
  const [error, setError] = useState("");
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
    loadReports();
    return () => clearTimeout(pollRef.current);
  }, [lead.id, loadReports]);

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

  async function remove() {
    if (!confirm(`Delete "${lead.name}" from the database? This is permanent.`)) return;
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
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{lead.name || "Unknown"}</h2>
            <div className="subtle">{lead.category || ""} {lead.rating ? `· ★ ${lead.rating} (${lead.reviews || "?"})` : ""}</div>
          </div>
          <button className="icon" onClick={onClose} title="Close"><X size={17} /></button>
        </header>

        <div className="drawer-body">
          <section className="drawer-card">
            <h3>Contact</h3>
            <div className="drawer-rows">
              {lead.phone && <div><Phone size={13} /> {lead.phone} {lead.whatsapp_status === "yes" && <span className="wa-badge">WA ✓</span>}{lead.whatsapp_status === "no" && <span className="wa-badge wa-no">WA ✗</span>}</div>}
              {lead.email && <div><Mail size={13} /> <a href={`mailto:${lead.email}`}>{lead.email}</a></div>}
              {lead.all_emails && lead.all_emails !== lead.email && <div className="subtle">Also: {lead.all_emails}</div>}
              {lead.address && <div><MapPin size={13} /> {lead.address}</div>}
              {lead.website && (
                <div><ExternalLink size={13} /> <a href={lead.website} target="_blank">{lead.domain || lead.website}</a></div>
              )}
              {lead.maps_url && <div><a href={lead.maps_url} target="_blank">Open on Google Maps</a></div>}
            </div>
          </section>

          <section className="drawer-card">
            <h3>Socials</h3>
            <div className="chips"><Socials lead={lead} full /></div>
          </section>

          <section className="drawer-card">
            <h3>Website health (Lighthouse)</h3>
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
            <p className="subtle">Live site inspection + Lighthouse (desktop & mobile) + social audit + AI analysis. Takes ~2–3 minutes.</p>
            {reports.map((r) => (
              <a key={r.file} className="report-link" href={`${BASE_PATH}/api/agent/reports/${r.file}`} target="_blank">
                <FileText size={14} /> {r.file} <span className="subtle">{new Date(r.createdAt).toLocaleString()}</span>
              </a>
            ))}
            {generating && (
              <div className="job-progress">
                <Loader2 size={14} className="spin" /> Generating…
                <div className="subtle">{(job.log || []).slice(-2).join(" · ")}</div>
              </div>
            )}
            {job?.status === "failed" && <div className="chat-error">Report failed: {job.error}</div>}
            {error && <div className="chat-error">{error}</div>}
            <div className="drawer-actions">
              <button className="primary" disabled={!lead.website || generating} onClick={generate}>
                <FileText size={15} /> {reports.length ? "Regenerate report" : "Generate report"}
              </button>
              <button className="danger" onClick={remove}><Trash2 size={15} /> Delete lead</button>
            </div>
            {!lead.website && <div className="subtle">No website on this lead — reports need a website.</div>}
          </section>

          <section className="drawer-card">
            <h3>Meta</h3>
            <div className="drawer-rows subtle">
              <div>Project: {lead.project || "-"}</div>
              <div>Query: {lead.query || "-"}</div>
              {lead.hours && <div>Hours: {lead.hours}</div>}
              <div>First seen: {lead.first_seen?.slice(0, 10)} · Updated: {lead.last_updated?.slice(0, 10)}</div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function LeadsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [hasEmail, setHasEmail] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null); // lead opened in the drawer

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (hasEmail) params.set("hasEmail", "1");
      if (minScore) params.set("minScore", String(minScore));
      const data = await jsonFetch(`/api/leads?${params.toString()}`);
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setStats(data.stats || null);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, hasEmail, minScore]);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={22} />
          <span>Lead Ops</span>
        </div>
        <nav className="nav">
          <Link className="nav-link" href="/">Projects</Link>
          <span className="nav-link active"><Database size={15} /> Leads</span>
          <Link className="nav-link" href="/agent"><Bot size={15} /> Agent</Link>
        </nav>
        {stats && (
          <div className="db-stats">
            <div><strong>{stats.total}</strong><span className="subtle">unique leads</span></div>
            <div><strong>{stats.withEmail}</strong><span className="subtle">with email</span></div>
            <div><strong>{stats.withWebsite}</strong><span className="subtle">with website</span></div>
            <div><strong>{stats.audited}</strong><span className="subtle">audited</span></div>
            <div><strong>{stats.projects}</strong><span className="subtle">projects</span></div>
          </div>
        )}
      </aside>

      <section className="project-main">
        <header className="topbar">
          <div>
            <h1>All leads</h1>
            <div className="subtle">
              Deduped across every project. Click a lead to inspect it, generate its report or delete it. {total} match.
            </div>
          </div>
          <a href={`${BASE_PATH}/api/leads/export`}>
            <button className="primary"><Download size={16} /> Export CSV</button>
          </a>
        </header>

        <div className="work">
          <section className="panel filters">
            <div className="field search-field">
              <Search size={15} />
              <input placeholder="Search name, domain, phone, email, category…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="check">
              <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} /> Has email
            </label>
            <label className="check">
              Min performance
              <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
                <option value={0}>any</option>
                <option value={50}>50+</option>
                <option value={90}>90+</option>
              </select>
            </label>
            <span className="subtle">{loading ? "Loading…" : `${rows.length} shown`}</span>
          </section>

          <div className="panel table-wrap tall">
            {!rows.length ? (
              <div className="empty">{loading ? "Loading…" : "No leads in the database yet. Run a project to populate it."}</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Website</th>
                    <th>Email</th>
                    <th>Socials</th>
                    <th>Desktop</th>
                    <th>Mobile</th>
                    <th>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr key={lead.id} className="row-click" onClick={() => setActive(lead)}>
                      <td className="name-cell">
                        {lead.name || "Unknown"}
                        <br />
                        <span className="subtle">{lead.category || lead.address || ""}</span>
                      </td>
                      <td>{lead.phone || "-"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {lead.website ? (
                          <a href={lead.website} target="_blank">{lead.domain || lead.website}</a>
                        ) : (
                          <span className="subtle">none</span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="subtle">{lead.enrich_status || "-"}</span>}
                      </td>
                      <td className="socials" onClick={(e) => e.stopPropagation()}>
                        <Socials lead={lead} />
                      </td>
                      <td className="score-cell">
                        <Score label="Perf" value={lead.desktop_performance} />
                        <Score label="SEO" value={lead.desktop_seo} />
                      </td>
                      <td className="score-cell">
                        <Score label="Perf" value={lead.mobile_performance} />
                        <Score label="SEO" value={lead.mobile_seo} />
                      </td>
                      <td className="subtle">{lead.project || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {active && (
        <LeadDrawer
          lead={active}
          onClose={() => setActive(null)}
          onDeleted={(id) => {
            setActive(null);
            setRows((r) => r.filter((x) => x.id !== id));
          }}
        />
      )}
    </main>
  );
}
