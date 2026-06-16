"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const REPORT_COST = 10; // credits per report (mirrors billing.REPORT_COST)

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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="h-[88vh] max-w-5xl p-0">
        <DialogHeader className="flex-row items-center justify-between gap-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="truncate">{lead.name || "Report"}</DialogTitle>
            <DialogDescription className="truncate">{lead.domain || lead.website}</DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline" title="Each report costs credits">{REPORT_COST} credits</span>
            <Button size="sm" disabled={!lead.website || generating} onClick={generate}>
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><FileText size={14} /> {reports.length ? "Regenerate" : "Generate"}</>}
            </Button>
            {latest && (
              <Button asChild size="sm" variant="outline">
                <a href={`${BASE_PATH}/api/agent/reports/${latest.file}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
              </Button>
            )}
          </div>
        </DialogHeader>

        {error && <div className="border-b border-border/60 bg-destructive/10 px-5 py-2 text-sm text-red-600">{error}</div>}
        {generating && (
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> {(job.log || []).slice(-1)[0] || "Working…"}
          </div>
        )}
        {job?.status === "failed" && <div className="border-b border-border/60 bg-destructive/10 px-5 py-2 text-sm text-red-600">Report failed: {job.error}</div>}

        <div className="min-h-0 flex-1 bg-white">
          {latest ? (
            <iframe title="Website report" src={`${BASE_PATH}/api/agent/reports/${latest.file}`} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full items-center justify-center bg-card p-10 text-center text-sm text-muted-foreground">
              {generating ? "Generating report, this takes a moment…" : "No report yet. Click Generate."}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
