"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, X } from "lucide-react";

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

// Lightweight report viewer that stays on the current page: shows the latest
// report inline in an iframe and can (re)generate one, polling the job to
// completion. `lead` must carry an id, name, domain and website.
export default function ReportModal({ lead, onClose }) {
  const [reports, setReports] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const loadReports = useCallback(async () => {
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/report`);
      setReports(data.reports || []);
    } catch {}
  }, [lead.id]);

  useEffect(() => {
    loadReports();
    return () => clearTimeout(pollRef.current);
  }, [loadReports]);

  async function pollJob(jobId) {
    try {
      const data = await jsonFetch(`/api/agent/jobs/${jobId}`);
      setJob({ id: jobId, ...data });
      if (data.status === "running") pollRef.current = setTimeout(() => pollJob(jobId), 2500);
      else loadReports();
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

  const latest = reports[0];
  const generating = job?.status === "running";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{lead.name || "Report"}</h2>
            <div className="subtle">{lead.domain || lead.website}</div>
          </div>
          <div className="report-modal-actions">
            <button className="primary" disabled={!lead.website || generating} onClick={generate}>
              {generating ? <><Loader2 size={14} className="spin" /> Generating…</> : <><FileText size={14} /> {reports.length ? "Regenerate" : "Generate"}</>}
            </button>
            {latest && (
              <a className="ghost-link-btn" href={`${BASE_PATH}/api/agent/reports/${latest.file}`} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Open
              </a>
            )}
            <button className="icon" onClick={onClose} title="Close"><X size={17} /></button>
          </div>
        </header>
        {error && <div className="chat-error">{error}</div>}
        {generating && (
          <div className="job-progress">
            <Loader2 size={14} className="spin" /> {(job.log || []).slice(-1)[0] || "Working…"}
          </div>
        )}
        {job?.status === "failed" && <div className="chat-error">Report failed: {job.error}</div>}
        <div className="report-modal-body">
          {latest ? (
            <iframe title="Website report" src={`${BASE_PATH}/api/agent/reports/${latest.file}`} />
          ) : (
            <div className="empty">{generating ? "Generating report — this takes a moment…" : "No report yet. Click Generate."}</div>
          )}
        </div>
      </div>
    </div>
  );
}
