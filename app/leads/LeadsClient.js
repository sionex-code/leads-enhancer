"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Database, Download, Search, ShieldCheck } from "lucide-react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function jsonFetch(url) {
  const res = await fetch(`${BASE_PATH}${url}`);
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

// Every social network we extract, with its short chip label.
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

export default function LeadsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [hasEmail, setHasEmail] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [loading, setLoading] = useState(false);

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

  // Debounce so typing in the search box doesn't hammer the DB.
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
          <Link className="nav-link" href="/">
            Projects
          </Link>
          <span className="nav-link active">
            <Database size={15} /> All leads
          </span>
        </nav>
        {stats && (
          <div className="db-stats">
            <div>
              <strong>{stats.total}</strong>
              <span className="subtle">unique leads</span>
            </div>
            <div>
              <strong>{stats.withEmail}</strong>
              <span className="subtle">with email</span>
            </div>
            <div>
              <strong>{stats.withWebsite}</strong>
              <span className="subtle">with website</span>
            </div>
            <div>
              <strong>{stats.audited}</strong>
              <span className="subtle">audited</span>
            </div>
            <div>
              <strong>{stats.projects}</strong>
              <span className="subtle">projects</span>
            </div>
          </div>
        )}
      </aside>

      <section className="project-main">
        <header className="topbar">
          <div>
            <h1>All leads</h1>
            <div className="subtle">
              Every business scraped across all projects, deduped by website / phone. {total} match the current filter.
            </div>
          </div>
          <a href={`${BASE_PATH}/api/leads/export`}>
            <button className="primary">
              <Download size={16} /> Export CSV
            </button>
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
                    <tr key={lead.id}>
                      <td className="name-cell">
                        {lead.name || "Unknown"}
                        <br />
                        <span className="subtle">{lead.category || lead.address || ""}</span>
                      </td>
                      <td>{lead.phone || "-"}</td>
                      <td>
                        {lead.website ? (
                          <a href={lead.website} target="_blank">
                            {lead.domain || lead.website}
                          </a>
                        ) : (
                          <span className="subtle">none</span>
                        )}
                      </td>
                      <td>
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`}>{lead.email}</a>
                        ) : (
                          <span className="subtle">{lead.enrich_status || "-"}</span>
                        )}
                      </td>
                      <td className="socials">
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
    </main>
  );
}
