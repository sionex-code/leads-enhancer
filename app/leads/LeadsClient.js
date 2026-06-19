"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AppShell from "../components/app/AppShell";
import AnimatedNumber from "../components/AnimatedNumber";
import ReportModal from "../components/ReportModal";
import ListsDialog from "../components/leads/ListsDialog";
import {
  Ban,
  BarChart3,
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Loader2,
  ListPlus,
  Mail,
  MailCheck,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Search,
  Send,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { cn, waMeLink } from "../lib/utils";

const LeadsMap = dynamic(() => import("../components/LeadsMap"), { ssr: false });

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const PAGE_SIZE = 120;
const REPORT_COST = 10; // credits per website report (mirrors billing.REPORT_COST)
const AUDIT_COST = 3; // credits per quick audit (mirrors billing.AUDIT_COST)

const WORKFLOWS = [
  // "All leads" tab intentionally hidden for the SaaS launch.
  { key: "needs-action", label: "Needs action" },
  { key: "watchlist", label: "Favorites" },
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

const PILL = {
  good: "bg-emerald-500/15 text-emerald-600",
  avg: "bg-amber-500/15 text-amber-600",
  bad: "bg-red-500/15 text-red-600",
  sent: "bg-sky-500/15 text-sky-600",
  watch: "bg-amber-500/15 text-amber-600",
  contact: "bg-primary/15 text-primary",
  muted: "bg-muted/60 text-muted-foreground",
};

function Pill({ tone = "muted", className, children, ...props }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", PILL[tone] || PILL.muted, className)}
      {...props}
    >
      {children}
    </span>
  );
}

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
  return "bad";
}

function Score({ label, value }) {
  if (value === "" || value === null || value === undefined) return <Pill tone="muted">{label} -</Pill>;
  return <Pill tone={scoreClass(value)} title={`${label}: ${value}/100`}>{label} {value}</Pill>;
}

// HTTP status pill for a lead's website (200 ok / 3xx redirect / 4xx-5xx error /
// 0 unreachable). null status = never checked.
function StatusPill({ lead }) {
  const code = lead.http_status;
  if (code === null || code === undefined || code === "") return null;
  const n = Number(code);
  let tone = "muted", label;
  if (!n) {
    tone = "bad";
    label = "down";
  } else if (n >= 200 && n < 300) {
    tone = "good";
    label = n;
  } else if (n >= 300 && n < 400) {
    tone = "avg";
    label = n;
  } else {
    tone = "bad";
    label = n;
  }
  const title = `HTTP ${n || "?"}${lead.http_status_text ? ` ${lead.http_status_text}` : ""}${lead.http_checked_at ? ` · checked ${new Date(lead.http_checked_at).toLocaleString()}` : ""}`;
  return <Pill tone={tone} title={title}>{label}</Pill>;
}

// Chatbot/live-chat verdict badge. "" = never scanned.
function ChatbotBadge({ lead }) {
  const v = lead.chatbot;
  if (!v) return null;
  const yes = v === "yes";
  const title = `${yes ? "Chatbot detected" : "No chatbot"}${lead.chatbot_vendors ? `: ${lead.chatbot_vendors}` : ""}${lead.chatbot_method ? ` (${lead.chatbot_method})` : ""}`;
  return <Pill tone={yes ? "good" : "muted"} title={title}><Bot size={12} /> {yes ? "Bot" : "No bot"}</Pill>;
}

function WorkflowBadge({ lead }) {
  const status = lead.outreach_status || "new";
  const tone = status === "complete" ? "good" : status === "sent" ? "sent" : status === "queued" ? "avg" : status === "skipped" ? "muted" : "muted";
  return <Pill tone={tone}>{OUTREACH_STATUS[status] || status}</Pill>;
}

function EmailBadge({ status }) {
  const value = status || "unset";
  const tone = value === "send" ? "good" : value === "do_not_send" ? "bad" : value === "later" ? "avg" : "muted";
  return <Pill tone={tone}>{EMAIL_STATUS[value] || value}</Pill>;
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
          {full ? label : label.slice(0, 2).toUpperCase()}
        </a>
      ))}
    </div>
  );
}

function QuickLeadActions({ lead, onPatch, onLists, compact = false }) {
  const busy = false;
  const iconSize = 15;
  return (
    <div className="flex flex-wrap items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.watchlist && "text-amber-500")} disabled={busy} onClick={() => onPatch(lead.id, { watchlist: !lead.watchlist })} title={lead.watchlist ? "Remove from favorites" : "Add to favorites"}>
        <Star size={iconSize} fill={lead.watchlist ? "currentColor" : "none"} />
      </Button>
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.list_count > 0 && "text-primary")} disabled={busy} onClick={() => onLists && onLists(lead)} title={lead.list_count > 0 ? `In ${lead.list_count} list${lead.list_count === 1 ? "" : "s"} — edit` : "Add to a list"}>
        <ListPlus size={iconSize} />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy} onClick={() => onPatch(lead.id, { email_status: lead.email_status === "send" ? "unset" : "send", contact_list: true })} title="Toggle send email">
        <MailCheck size={iconSize} />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy} onClick={() => onPatch(lead.id, { outreach_status: "sent", contact_list: true })} title="Mark message sent">
        <Send size={iconSize} />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy} onClick={() => onPatch(lead.id, { outreach_status: "complete", contact_list: true })} title="Mark complete">
        <CheckCircle2 size={iconSize} />
      </Button>
    </div>
  );
}

// Inline per-row contact actions: grab email/socials, check status/chatbot/
// WhatsApp, run a quick audit (Health scores), open the website report, and
// remove. Remove is context-aware (see removeLead in parent): in a watch/custom-
// list view it just drops the lead from that view; in the full leads view it
// deletes permanently. The audit button spins while its job runs; the report
// button is tinted once a report exists for the domain.
function RowActions({ lead, busy = {}, onEnrich, onWhatsapp, onAudit, onReport, onRemove, onStatus, onChatbot, removeTitle }) {
  const wa = waState(lead);
  const waLink = waMeLink(lead);
  return (
    <div className="flex flex-wrap items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="icon" className="h-8 w-8" title={lead.email ? "Re-grab email + socials" : "Grab email + socials"} disabled={!lead.website || busy.enrich} onClick={() => onEnrich(lead)}>
        {busy.enrich ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" title={lead.website ? `Check website status${lead.http_status ? ` (last: ${lead.http_status || "down"})` : ""}` : "No website to check"} disabled={!lead.website || busy.status} onClick={() => onStatus(lead)}>
        {busy.status ? <Loader2 size={14} className="animate-spin" /> : <Globe2 size={14} />}
      </Button>
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.chatbot === "yes" && "text-emerald-600")} title={lead.website ? `Scan for chatbot${lead.chatbot ? ` (last: ${lead.chatbot})` : ""}` : "No website to scan"} disabled={!lead.website || busy.chatbot} onClick={() => onChatbot(lead)}>
        {busy.chatbot ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
      </Button>
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", wa === "yes" && "text-emerald-600")} title={lead.phone ? (wa ? `WhatsApp: ${lead.whatsapp_status}` : "Check WhatsApp") : "No phone to check"} disabled={!lead.phone || busy.whatsapp} onClick={() => onWhatsapp(lead)}>
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
      <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.has_report && "text-primary")} title={lead.website ? (lead.has_report ? "Report ready — view / regenerate" : "Generate website report") : "No website for a report"} disabled={!lead.website} onClick={() => onReport(lead)}>
        <FileText size={14} />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600" title={removeTitle} disabled={busy.remove} onClick={() => onRemove(lead)}>
        {busy.remove ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </Button>
    </div>
  );
}

function DrawerCard({ title, children }) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function LeadDrawer({ lead, onClose, onDeleted, onPatch, onStatus, onChatbot }) {
  const [reports, setReports] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState("");
  const pollRef = useRef(null);

  async function runScan(kind) {
    setScanning(kind);
    setError("");
    try {
      if (kind === "status") await onStatus(lead);
      else await onChatbot(lead);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning("");
    }
  }

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
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-lg p-0">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/60 bg-card/95 px-5 py-4 pr-12 backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold leading-tight">{lead.name || "Unknown"}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <WorkflowBadge lead={lead} />
              <EmailBadge status={lead.email_status} />
              {lead.watchlist ? <Pill tone="watch"><Star size={12} fill="currentColor" /> Favorite</Pill> : null}
              {lead.contact_list ? <Pill tone="contact"><Users size={12} /> List</Pill> : null}
            </div>
          </div>
        </header>

        <div className="space-y-4 p-5">
          <DrawerCard title="Workflow">
            <div className="grid grid-cols-2 gap-2">
              <button className={cn("flex flex-col items-center gap-1 rounded-lg border p-3 text-sm transition-colors", lead.watchlist ? "border-amber-500/50 bg-amber-500/10 text-amber-600" : "border-border hover:bg-accent")} onClick={() => patch({ watchlist: !lead.watchlist })}>
                <Star size={16} fill={lead.watchlist ? "currentColor" : "none"} />
                <span>Favorites</span>
              </button>
              <button className={cn("flex flex-col items-center gap-1 rounded-lg border p-3 text-sm transition-colors", lead.contact_list ? "border-primary/50 bg-primary/10 text-primary" : "border-border hover:bg-accent")} onClick={() => patch({ contact_list: !lead.contact_list })}>
                <ListPlus size={16} />
                <span>Custom list</span>
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Email decision</span>
                <Select value={lead.email_status || "unset"} onChange={(e) => patch({ email_status: e.target.value })}>
                  {Object.entries(EMAIL_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Outreach status</span>
                <Select value={lead.outreach_status || "new"} onChange={(e) => patch({ outreach_status: e.target.value, contact_list: e.target.value !== "new" })}>
                  {Object.entries(OUTREACH_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </label>
            </div>
            <Textarea
              className="mt-3"
              placeholder="Notes about outreach, objection, next step, owner, or email copy..."
              value={notes}
              rows={5}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={saving} onClick={saveNotes}><MessageSquare size={15} /> Save notes</Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => patch({ outreach_status: "sent", contact_list: true })}><Send size={15} /> Mark sent</Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => patch({ outreach_status: "complete", contact_list: true })}><CheckCircle2 size={15} /> Complete</Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => patch({ outreach_status: "skipped", email_status: "do_not_send" })}><Ban size={15} /> Skip</Button>
            </div>
          </DrawerCard>

          <DrawerCard title="Contact">
            <div className="space-y-1.5 text-sm">
              {lead.phone && (
                <div className="flex items-center gap-2">
                  <Phone size={13} className="text-muted-foreground" />
                  {lead.phone}
                  {waState(lead) === "yes" && <MessageCircle size={14} className="text-emerald-600" title="On WhatsApp" />}
                  {waState(lead) === "no" && <MessageCircle size={14} className="text-muted-foreground" title="Not on WhatsApp" />}
                </div>
              )}
              {lead.email && <div className="flex items-center gap-2"><Mail size={13} className="text-muted-foreground" /> <a className="text-primary hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></div>}
              {lead.all_emails && lead.all_emails !== lead.email && <div className="text-xs text-muted-foreground">Also: {lead.all_emails}</div>}
              {lead.address && <div className="flex items-center gap-2"><MapPin size={13} className="text-muted-foreground" /> {lead.address}</div>}
              {lead.website && <div className="flex items-center gap-2"><ExternalLink size={13} className="text-muted-foreground" /> <a className="text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.domain || lead.website}</a></div>}
              {Number.isFinite(lead.lat) && Number.isFinite(lead.lng) && (
                <div className="mt-3">
                  <LeadsMap
                    center={{ lat: lead.lat, lng: lead.lng }}
                    radiusKm={1}
                    points={[{ lat: lead.lat, lng: lead.lng, name: lead.name || "Lead" }]}
                    interactive={false}
                    height={200}
                    className="rounded-lg overflow-hidden border border-border"
                  />
                </div>
              )}
              {lead.maps_url && <div className="mt-1.5"><a className="text-primary hover:underline" href={lead.maps_url} target="_blank" rel="noreferrer">Open on Google Maps</a></div>}
            </div>
          </DrawerCard>

          <DrawerCard title="Socials">
            <Socials lead={lead} full />
          </DrawerCard>

          <DrawerCard title="Website status & chatbot">
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                Status: {lead.http_status === null || lead.http_status === undefined || lead.http_status === ""
                  ? <span className="text-xs text-muted-foreground">not checked</span>
                  : <><StatusPill lead={lead} /> {lead.http_status_text ? <span className="text-xs text-muted-foreground">{lead.http_status_text}</span> : null}</>}
              </div>
              <div className="flex items-center gap-2">
                Chatbot: {lead.chatbot
                  ? <><ChatbotBadge lead={lead} /> {lead.chatbot_vendors ? <span className="text-xs text-muted-foreground">{lead.chatbot_vendors}</span> : null}</>
                  : <span className="text-xs text-muted-foreground">not scanned</span>}
              </div>
              {lead.chatbot_checked_at && <div className="text-xs text-muted-foreground">Scanned: {new Date(lead.chatbot_checked_at).toLocaleString()}</div>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!lead.website || !!scanning} onClick={() => runScan("status")}>
                {scanning === "status" ? <Loader2 size={15} className="animate-spin" /> : <Globe2 size={15} />} Check status
              </Button>
              <Button size="sm" variant="outline" disabled={!lead.website || !!scanning} onClick={() => runScan("chatbot")}>
                {scanning === "chatbot" ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />} Scan chatbot
              </Button>
            </div>
            {!lead.website && <div className="mt-2 text-xs text-muted-foreground">No website on this lead.</div>}
          </DrawerCard>

          <DrawerCard title="Website health">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Desktop</span>
                <Score label="Perf" value={lead.desktop_performance} />
                <Score label="SEO" value={lead.desktop_seo} />
                <Score label="A11y" value={lead.desktop_accessibility} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Mobile</span>
                <Score label="Perf" value={lead.mobile_performance} />
                <Score label="SEO" value={lead.mobile_seo} />
                <Score label="A11y" value={lead.mobile_accessibility} />
              </div>
            </div>
          </DrawerCard>

          <DrawerCard title="Independent report">
            <p className="text-xs text-muted-foreground">Fast real-Chrome audit (desktop + mobile): speed, layout, mobile, SEO, security, support-chat, summarized by AI, with the raw report attached. <span className="font-medium text-foreground">Costs {REPORT_COST} credits.</span></p>
            <div className="mt-2 space-y-1.5">
              {reports.map((r) => (
                <a key={r.file} className="flex items-center gap-2 text-sm text-primary hover:underline" href={`${BASE_PATH}/api/agent/reports/${r.file}`} target="_blank" rel="noreferrer">
                  <FileText size={14} /> {r.file} <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                </a>
              ))}
            </div>
            {generating && (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> {job.cancelRequested ? "Stopping..." : "Generating..."}
                <button className="text-red-600 hover:underline" onClick={cancelJob} title="Stop this report job" disabled={!!job.cancelRequested}>Stop</button>
                <div className="text-xs text-muted-foreground">{(job.log || []).slice(-2).join(" | ")}</div>
              </div>
            )}
            {job?.status === "failed" && <div className="mt-2 text-sm text-red-600">Report failed: {job.error}</div>}
            {job?.status === "cancelled" && <div className="mt-2 text-xs text-muted-foreground">Report job cancelled.</div>}
            {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!lead.website || generating} onClick={generate}>
                <FileText size={15} /> {reports.length ? "Regenerate report" : "Generate report"}
              </Button>
              <Button size="sm" variant="destructive" onClick={remove}><Trash2 size={15} /> Delete lead</Button>
            </div>
            {!lead.website && <div className="mt-2 text-xs text-muted-foreground">No website on this lead. Reports need a website.</div>}
          </DrawerCard>

          <DrawerCard title="Meta">
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Project: {lead.project || "-"}</div>
              <div>Query: {lead.query || "-"}</div>
              {lead.hours && <div>Hours: {lead.hours}</div>}
              <div>First seen: {lead.first_seen?.slice(0, 10)} | Updated: {lead.last_updated?.slice(0, 10)}</div>
              {lead.message_sent_at && <div>Sent: {new Date(lead.message_sent_at).toLocaleString()}</div>}
              {lead.completed_at && <div>Completed: {new Date(lead.completed_at).toLocaleString()}</div>}
            </div>
          </DrawerCard>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function LeadsPage({ initialWorkflow = "", pageTitle = "Lead manager", activeNav = "leads" }) {
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
  // Bulk selection + the user's live credit balance (for the cost warning).
  const [selected, setSelected] = useState(() => new Set());
  const [credits, setCredits] = useState(null);
  const [bulkBusy, setBulkBusy] = useState("");
  // Live progress for an in-flight bulk batch — reports OR audits. The card and
  // poller are shared; `kind` ("report" | "audit") just switches the labels.
  // { kind, total, done, failed, latest, finished, jobIds }.
  const [batch, setBatch] = useState(null);
  const batchPollRef = useRef(null);
  // Set to the latest `load` so the batch poller can refresh the list on finish
  // without depending on declaration order.
  const loadRef = useRef(null);
  // Named lists: the user's lists, the active list filter, and the open dialog.
  const [lists, setLists] = useState([]);
  const [listFilter, setListFilter] = useState("");
  const [listDialog, setListDialog] = useState(null);
  // Tiny self-dismissing toast for quick confirmations (favorite, mark sent, …).
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const mergeLead = useCallback((lead) => {
    setRows((current) => current.map((row) => (row.id === lead.id ? lead : row)));
    setActive((current) => (current?.id === lead.id ? lead : current));
  }, []);

  const patchLead = useCallback(async (id, patch) => {
    // Apply the change immediately so the UI responds on click; the PATCH is a
    // ~half-second DB round-trip and waiting for it felt like nothing happened.
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setActive((cur) => (cur?.id === id ? { ...cur, ...patch } : cur));
    if (patch.watchlist !== undefined) {
      showToast(patch.watchlist ? "★ Added to favorites" : "Removed from favorites");
    }
    try {
      const data = await jsonFetch(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (data.lead) mergeLead(data.lead);
      return data.lead;
    } catch (err) {
      // Revert to the server's truth and surface the failure.
      jsonFetch(`/api/leads/${id}`).then((d) => d.lead && mergeLead(d.lead)).catch(() => {});
      showToast(err.message || "Couldn't save — try again");
      return null;
    }
  }, [mergeLead, showToast]);

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

  const checkStatusOne = useCallback(async (lead) => {
    const key = `${lead.id}:status`;
    setBusyKey(key, true);
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/status`, { method: "POST" });
      if (data.lead) mergeLead(data.lead);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyKey(key, false);
    }
  }, [mergeLead, setBusyKey]);

  const scanChatbotOne = useCallback(async (lead) => {
    const key = `${lead.id}:chatbot`;
    setBusyKey(key, true);
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/chatbot`, { method: "POST" });
      if (data.lead) mergeLead(data.lead);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyKey(key, false);
    }
  }, [mergeLead, setBusyKey]);

  const [batchBusy, setBatchBusy] = useState("");
  const batchScan = useCallback(async (action) => {
    const ids = rows.filter((r) => r.website).map((r) => r.id);
    if (!ids.length) {
      alert("No leads with a website on this page.");
      return;
    }
    const label = action === "chatbot" ? "chatbot scan" : "status check";
    if (action === "chatbot" && !confirm(`Run a ${label} on ${ids.length} lead(s)? This opens Chrome and can take a while.`)) return;
    setBatchBusy(action);
    try {
      const data = await jsonFetch(`/api/leads/scan`, { method: "POST", body: JSON.stringify({ ids, action }) });
      for (const lead of data.leads || []) {
        if (lead && lead.id && !lead.error) mergeLead(lead);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setBatchBusy("");
    }
  }, [rows, mergeLead]);

  // Keep a live credit balance for the bulk-report cost warning.
  useEffect(() => {
    let alive = true;
    jsonFetch("/api/me").then((d) => { if (alive) setCredits(d?.entitlement?.credits ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const refreshCredits = useCallback(() => {
    jsonFetch("/api/me").then((d) => setCredits(d?.entitlement?.credits ?? null)).catch(() => {});
  }, []);

  // Poll every job in a bulk batch (reports or audits) and roll the per-job
  // progress up into a single { done / total } figure for the progress panel.
  // Each job exposes `sites` (planned) and `results` (completed), so done =
  // Σ results, total = Σ sites. On completion we refresh credits and reload the
  // list so new scores / "Report ✓" badges appear.
  const pollBatch = useCallback((jobIds, total, kind) => {
    clearTimeout(batchPollRef.current);
    const tick = async () => {
      const jobs = await Promise.all(
        jobIds.map((id) => jsonFetch(`/api/agent/jobs/${id}`).catch(() => null))
      );
      let done = 0, latest = "";
      let allTerminal = true;
      for (const job of jobs) {
        if (!job) { allTerminal = false; continue; }
        done += (job.results || []).length;
        if (job.status === "running") allTerminal = false;
        const line = (job.log || []).slice(-1)[0];
        if (line) latest = line;
      }
      done = Math.min(done, total);
      // "failed" only makes sense once every job has settled: any sites that never
      // landed (total − done). Mid-flight that gap is just work in progress.
      const failed = allTerminal ? Math.max(0, total - done) : 0;
      setBatch({ kind, jobIds, total, done, failed, latest, finished: allTerminal });
      if (allTerminal) {
        refreshCredits();
        loadRef.current?.(); // surface new audit scores / report badges
      } else {
        batchPollRef.current = setTimeout(tick, 2500);
      }
    };
    tick();
  }, [refreshCredits]);

  // Charge + launch a bulk batch (report or audit) for the given lead ids, then
  // show the shared progress panel polling each job to completion. `kind` selects
  // the endpoint, per-unit cost, and labels.
  const runBatch = useCallback(async (kind, ids) => {
    if (!ids.length) return;
    const unit = kind === "audit" ? AUDIT_COST : REPORT_COST;
    const noun = kind === "audit" ? "audit" : "report";
    const endpoint = kind === "audit" ? "/api/leads/audit/bulk" : "/api/leads/report/bulk";
    const cost = ids.length * unit;
    const have = credits ?? 0;
    if (cost > have) {
      alert(`Not enough credits. ${ids.length} ${noun}(s) need ${cost} credits and you have ${have}. Reduce your selection or top up in Billing.`);
      return;
    }
    if (!confirm(`Run ${ids.length} ${noun}${ids.length === 1 ? "" : "s"}?\n\nThis will use ${cost} credits (${ids.length} × ${unit}). You have ${have}, leaving ${have - cost}.`)) return;
    setBulkBusy(kind);
    try {
      const data = await jsonFetch(endpoint, { method: "POST", body: JSON.stringify({ ids }) });
      if (typeof data.credits === "number") setCredits(data.credits);
      setSelected(new Set());
      const jobIds = data.jobIds || [];
      setBatch({ kind, jobIds, total: data.count, done: 0, failed: 0, latest: "Starting…", finished: false });
      if (jobIds.length) pollBatch(jobIds, data.count, kind);
    } catch (err) {
      refreshCredits();
      alert(err.message);
    } finally {
      setBulkBusy("");
    }
  }, [credits, refreshCredits, pollBatch]);

  // Bulk actions over the current selection (only website-bearing rows are
  // billable / auditable).
  const bulkReport = useCallback(() => {
    runBatch("report", rows.filter((r) => r.website && selected.has(r.id)).map((r) => r.id));
  }, [runBatch, rows, selected]);
  const bulkAudit = useCallback(() => {
    runBatch("audit", rows.filter((r) => r.website && selected.has(r.id)).map((r) => r.id));
  }, [runBatch, rows, selected]);

  // Single-row quick audit: charge AUDIT_COST, run the desktop+mobile scan as a
  // background job, spin the row's audit button while polling it, then merge the
  // refreshed lead so its new Health scores appear in place.
  const auditOne = useCallback(async (lead) => {
    if (!lead.website) return;
    const have = credits ?? 0;
    if (AUDIT_COST > have) { alert(`Not enough credits — an audit needs ${AUDIT_COST} and you have ${have}.`); return; }
    if (!confirm(`Audit ${lead.name || "this site"} (desktop + mobile) for ${AUDIT_COST} credits?`)) return;
    const key = `${lead.id}:audit`;
    setBusyKey(key, true);
    try {
      const data = await jsonFetch(`/api/leads/${lead.id}/audit`, { method: "POST" });
      if (typeof data.credits === "number") setCredits(data.credits);
      await new Promise((resolve) => {
        const tick = async () => {
          const job = await jsonFetch(`/api/agent/jobs/${data.jobId}`).catch(() => null);
          if (!job || job.status === "running") { setTimeout(tick, 2500); return; }
          resolve();
        };
        tick();
      });
      const fresh = await jsonFetch(`/api/leads/${lead.id}`).catch(() => null);
      if (fresh?.lead) mergeLead(fresh.lead);
      showToast("Audit complete — scores updated");
    } catch (err) {
      refreshCredits();
      alert(err.message);
    } finally {
      setBusyKey(key, false);
    }
  }, [credits, mergeLead, setBusyKey, showToast, refreshCredits]);

  // Delete the current selection. Context-aware, mirroring the per-row remove:
  // in a Favorites / Custom-list view it drops the leads from that list (they stay
  // in the database); in any other view it permanently deletes them.
  const bulkDelete = useCallback(async () => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    const listMode = workflow === "watchlist" || workflow === "contacts";
    if (listMode) {
      const field = workflow === "watchlist" ? "watchlist" : "contact_list";
      const label = workflow === "watchlist" ? "favorites" : "this list";
      if (!confirm(`Remove ${ids.length} lead${ids.length === 1 ? "" : "s"} from ${label}? They stay in your leads database.`)) return;
      setBulkBusy("delete");
      try {
        await Promise.all(ids.map((id) => jsonFetch(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: false }) })));
        const removed = new Set(ids);
        setRows((r) => r.filter((x) => !removed.has(x.id)));
        setSelected(new Set());
      } catch (err) {
        alert(err.message);
        loadRef.current?.();
      } finally {
        setBulkBusy("");
      }
      return;
    }
    if (!confirm(`Permanently delete ${ids.length} lead${ids.length === 1 ? "" : "s"} from your database? This cannot be undone.`)) return;
    setBulkBusy("delete");
    try {
      await jsonFetch("/api/leads/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) });
      const removed = new Set(ids);
      setRows((r) => r.filter((x) => !removed.has(x.id)));
      setSelected(new Set());
    } catch (err) {
      alert(err.message);
      loadRef.current?.();
    } finally {
      setBulkBusy("");
    }
  }, [rows, selected, workflow]);

  // Stop polling if the component unmounts mid-batch.
  useEffect(() => () => clearTimeout(batchPollRef.current), []);

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
    ? "Remove from favorites"
    : workflow === "contacts"
      ? "Remove from custom list"
      : "Delete lead permanently";

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set()); // selection is scoped to the current page/filter view
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (project) params.set("project", project);
      if (country) params.set("country", country);
      if (city) params.set("city", city);
      if (workflow) params.set("workflow", workflow);
      if (hasEmail) params.set("hasEmail", "1");
      if (minScore) params.set("minScore", String(minScore));
      if (listFilter) params.set("list", listFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      const data = await jsonFetch(`/api/leads?${params.toString()}`);
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setStats(data.stats || null);
      setProjects(data.projects || []);
      setCountries(data.countries || []);
      setCities(data.cities || []);
      setLists(data.lists || []);
      if (active?.id) {
        const next = (data.rows || []).find((row) => row.id === active.id);
        if (next) setActive(next);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [active?.id, city, country, hasEmail, listFilter, minScore, page, project, search, workflow]);
  loadRef.current = load; // keep the batch poller's refresh hook pointed at the latest load

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
    ["Total", stats?.total || 0, ""],
    ["Favorites", stats?.watchlist || 0, "watchlist"],
    ["Custom list", stats?.contactList || 0, "contacts"],
    ["Email ready", stats?.emailReady || 0, "email-ready"],
    ["Queued", stats?.queued || 0, "queued"],
    ["Sent", stats?.sent || 0, "sent"],
    ["Done", stats?.completed || 0, "complete"],
  ];
  const pageStart = total && rows.length ? page * PAGE_SIZE + 1 : 0;
  const pageEnd = total && rows.length ? page * PAGE_SIZE + rows.length : 0;
  const hasNextPage = rows.length > 0 && pageEnd < total;

  // Bulk-selection derived values (scoped to the current page's rows). Any lead can
  // be selected (e.g. to add to a list); only those with a website are "reportable",
  // which is what the credit cost is based on.
  const selectableIds = rows.map((r) => r.id);
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length;
  const reportableCount = rows.filter((r) => r.website && selected.has(r.id)).length;
  const reportCost = reportableCount * REPORT_COST;
  const auditCost = reportableCount * AUDIT_COST;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const notEnoughForReport = credits != null && reportCost > credits;
  const notEnoughForAudit = credits != null && auditCost > credits;
  const batchRunning = !!batch && !batch.finished;
  const toggleSelectAll = () => {
    setSelected((s) => {
      const n = new Set(s);
      if (selectableIds.every((id) => n.has(id))) selectableIds.forEach((id) => n.delete(id));
      else selectableIds.forEach((id) => n.add(id));
      return n;
    });
  };

  // Stat tiles rendered into the sidebar (AppShell sidebarExtra slot).
  const sidebarStats = stats ? (
    <div className="pb-4">
      <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pipeline</div>
      <div className="grid grid-cols-2 gap-1.5">
        {statTiles.map(([label, value, wf]) => (
          <button
            key={label}
            onClick={() => setWorkflow(wf)}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-left transition-colors",
              workflow === wf ? "border-primary/50 bg-primary/10" : "border-border hover:bg-accent"
            )}
          >
            <div className="text-base font-bold"><AnimatedNumber value={value} /></div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={!!batchBusy || loading} onClick={() => batchScan("status")} title="Check website status for all leads on this page">
        {batchBusy === "status" ? <Loader2 size={16} className="animate-spin" /> : <Globe2 size={16} />} <span className="hidden lg:inline">Check status</span>
      </Button>
      <Button variant="outline" size="sm" disabled={!!batchBusy || loading} onClick={() => batchScan("chatbot")} title="Scan all leads on this page for a chatbot">
        {batchBusy === "chatbot" ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />} <span className="hidden lg:inline">Scan chatbots</span>
      </Button>
      <Button asChild size="sm">
        <a href={`${BASE_PATH}/api/leads/export`}><Download size={16} /> <span className="hidden sm:inline">Export CSV</span></a>
      </Button>
    </>
  );

  const subtitle = `${total.toLocaleString()} lead${total === 1 ? "" : "s"} match · manage watch lists, email intent, outreach status & notes`;

  return (
    <AppShell active={activeNav} title={pageTitle} subtitle={subtitle} actions={actions} sidebarExtra={sidebarStats}>
      <div className="space-y-4 p-4 sm:p-6">
        {/* Toolbar */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Add single site or domain..." value={manualSite} onChange={(e) => setManualSite(e.target.value)} className="pl-9" />
              </div>
              <Input className="lg:w-40" placeholder="Lead name" value={manualName} onChange={(e) => setManualName(e.target.value)} />
              <Input className="lg:w-40" placeholder="Notes" value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} />
              <Button variant="outline" disabled={!manualSite.trim() || !!adding} onClick={() => addManualLead("watchlist")}><Star size={15} /> Favorite</Button>
              <Button disabled={!manualSite.trim() || !!adding} onClick={() => addManualLead("contact_list")}><ListPlus size={15} /> List</Button>
            </div>

            <Tabs value={workflow} onValueChange={setWorkflow}>
              <TabsList className="flex-wrap">
                {WORKFLOWS.map((item) => (
                  <TabsTrigger key={item.key || "all"} value={item.key}>{item.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search name, domain, phone, email, category, notes..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-auto min-w-[140px]">
                <option value="">All projects</option>
                {projects.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
              <Select value={country} onChange={(e) => { setCountry(e.target.value); setCity(""); }} className="w-auto min-w-[140px]">
                <option value="">All countries</option>
                {countries.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
              </Select>
              <Select value={city} onChange={(e) => setCity(e.target.value)} className="w-auto min-w-[120px]">
                <option value="">All cities</option>
                {cities.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
              </Select>
              <Select value={listFilter} onChange={(e) => setListFilter(e.target.value)} className="w-auto min-w-[120px]" title="Filter by list">
                <option value="">All lists</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
              </Select>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} className="accent-[hsl(var(--primary))]" /> Has email
              </label>
              <Select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="w-auto min-w-[100px]">
                <option value={0}>Any perf</option>
                <option value={50}>Perf 50+</option>
                <option value={90}>Perf 90+</option>
              </Select>
              <span className="ml-auto text-xs text-muted-foreground">
                {loading ? "Loading..." : total ? `${pageStart}-${pageEnd} of ${total}` : "0 shown"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Bulk action bar — add to a list, audit, report, or delete the selection */}
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
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
              <Button variant="outline" size="sm" onClick={() => setListDialog({ ids: [...selected] })}><ListPlus size={15} /> Add to list</Button>
              <Button variant="outline" size="sm" disabled={!!bulkBusy || batchRunning || reportableCount === 0 || notEnoughForAudit} onClick={bulkAudit} title={notEnoughForAudit ? "Not enough credits" : `Audit ${reportableCount} site(s) — ${auditCost} credits`}>
                {bulkBusy === "audit" ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />}
                Audit {reportableCount}
              </Button>
              <Button size="sm" disabled={!!bulkBusy || batchRunning || reportableCount === 0 || notEnoughForReport} onClick={bulkReport} title={notEnoughForReport ? "Not enough credits" : `Generate ${reportableCount} report(s) — ${reportCost} credits`}>
                {bulkBusy === "report" ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                Report {reportableCount}
              </Button>
              <Button variant="destructive" size="sm" disabled={!!bulkBusy} onClick={bulkDelete} title={workflow === "watchlist" || workflow === "contacts" ? "Remove selected from this list" : "Delete selected permanently"}>
                {bulkBusy === "delete" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {workflow === "watchlist" || workflow === "contacts" ? "Remove" : "Delete"}
              </Button>
            </div>
          </div>
        )}

        {/* Table / cards */}
        <Card className="overflow-hidden">
          {!rows.length ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{loading ? "Loading..." : "No leads match this view."}</div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 p-3 md:hidden">
                {rows.map((lead, idx) => {
                  const wa = waState(lead);
                  const ownerReplied = lead.owner_replied;
                  return (
                  <div className={cn("cursor-pointer rounded-lg border bg-card/60 p-3", selected.has(lead.id) ? "border-primary/50 bg-primary/5" : "border-border")} key={`m-${lead.id}`} onClick={() => toggleSelect(lead.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.name || "lead"}`}
                          checked={selected.has(lead.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(lead.id)}
                          className="mt-0.5 accent-[hsl(var(--primary))]"
                        />
                        <div>
                          <span className="mr-1 text-[10px] text-muted-foreground">#{page * PAGE_SIZE + idx + 1}</span>
                          <button type="button" className="text-left text-sm font-medium hover:text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setActive(lead); }} title="Open lead details">{lead.name || "Unknown"}</button>
                        </div>
                      </div>
                      <span className="line-clamp-1 max-w-[120px] text-xs text-muted-foreground" title={lead.category || lead.address || lead.project || ""}>{lead.category || lead.address || lead.project || ""}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <WorkflowBadge lead={lead} />
                      <EmailBadge status={lead.email_status} />
                      {lead.watchlist ? <Pill tone="watch"><Star size={12} fill="currentColor" /> Favorite</Pill> : null}
                      {lead.has_report ? <Pill tone="contact"><FileText size={12} /> Report</Pill> : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                      {lead.phone && <span>{lead.phone}</span>}
                      {wa === "yes" && <MessageCircle size={14} className="text-emerald-600" title="On WhatsApp" />}
                      {wa === "no" && <MessageCircle size={14} className="text-muted-foreground" title="Not on WhatsApp" />}
                      {lead.domain && <span className="max-w-[120px] truncate text-xs text-muted-foreground" title={lead.domain}>{lead.domain}</span>}
                    </div>
                    {lead.email && <div className="mt-1 truncate text-sm text-primary" title={lead.email}>{lead.email}</div>}
                    {lead.notes && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{lead.notes}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusPill lead={lead} />
                      <ChatbotBadge lead={lead} />
                      {lead.rating != null && (
                        <Pill tone="muted"><Star size={11} className="text-amber-500" fill="currentColor" /> {lead.rating}</Pill>
                      )}
                      {lead.reviews != null && (
                        <Pill tone="muted">{Number(lead.reviews).toLocaleString()} rev</Pill>
                      )}
                      {ownerReplied === 1 && (
                        <Pill tone="good">Owner replied {lead.owner_reply_count != null ? `(${lead.owner_reply_count})` : ""}</Pill>
                      )}
                      {ownerReplied === 0 && (
                        <Pill tone="muted">No reply</Pill>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                      <QuickLeadActions lead={lead} onPatch={patchLead} onLists={(l) => setListDialog({ lead: l })} compact />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <RowActions
                        lead={lead}
                        busy={{ enrich: busy[`${lead.id}:enrich`], whatsapp: busy[`${lead.id}:whatsapp`], remove: busy[`${lead.id}:remove`], status: busy[`${lead.id}:status`], chatbot: busy[`${lead.id}:chatbot`], audit: busy[`${lead.id}:audit`] }}
                        onEnrich={enrichOne}
                        onWhatsapp={checkWhatsapp}
                        onAudit={auditOne}
                        onReport={setReportLead}
                        onRemove={removeLead}
                        onStatus={checkStatusOne}
                        onChatbot={scanChatbotOne}
                        removeTitle={removeTitle}
                      />
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all leads with a website"
                          checked={allSelected}
                          disabled={!selectableIds.length}
                          onChange={toggleSelectAll}
                          className="accent-[hsl(var(--primary))]"
                        />
                      </TableHead>
                      <TableHead className="w-8 text-muted-foreground">#</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Reviews</TableHead>
                      <TableHead>Owner Reply</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((lead, idx) => {
                      const wa = waState(lead);
                      const ownerReplied = lead.owner_replied;
                      return (
                      <TableRow key={lead.id} className={cn("cursor-pointer", selected.has(lead.id) && "bg-primary/5")} onClick={() => toggleSelect(lead.id)}>
                        <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${lead.name || "lead"}`}
                            checked={selected.has(lead.id)}
                            onChange={() => toggleSelect(lead.id)}
                            className="accent-[hsl(var(--primary))]"
                            title="Select lead"
                          />
                        </TableCell>
                        <TableCell className="w-8 text-xs text-muted-foreground tabular-nums">
                          {page * PAGE_SIZE + idx + 1}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <button type="button" className="block max-w-full truncate text-left font-medium hover:text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setActive(lead); }} title={lead.name || "Unknown"}>{lead.name || "Unknown"}</button>
                          <div className="truncate text-xs text-muted-foreground" title={lead.category || lead.address || ""}>{lead.category || lead.address || ""}</div>
                          {lead.notes && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{lead.notes}</div>}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          {lead.email ? (
                            <a onClick={(e) => e.stopPropagation()} className="block max-w-full truncate text-xs text-primary hover:underline" href={`mailto:${lead.email}`} title={lead.email}>{lead.email}</a>
                          ) : (
                            <span className="text-xs text-muted-foreground">{lead.enrich_status || "no email"}</span>
                          )}
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                            <span>{lead.phone || "-"}</span>
                            {wa === "yes" && <MessageCircle size={14} className="shrink-0 text-emerald-600" title="On WhatsApp" />}
                            {wa === "no" && <MessageCircle size={14} className="shrink-0 text-muted-foreground" title="Not on WhatsApp" />}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {lead.rating != null ? (
                            <span className="flex items-center gap-1"><Star size={12} className="text-amber-500" fill="currentColor" />{lead.rating}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {lead.reviews != null ? (
                            <span>{Number(lead.reviews).toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {ownerReplied === 1 ? (
                            <span className="text-emerald-600">Yes {lead.owner_reply_count != null ? `(${lead.owner_reply_count})` : ""}</span>
                          ) : ownerReplied === 0 ? (
                            <span className="text-muted-foreground">No</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <WorkflowBadge lead={lead} />
                            {lead.watchlist ? <Pill tone="watch"><Star size={12} fill="currentColor" /> Favorite</Pill> : null}
                            {lead.contact_list ? <Pill tone="contact"><Users size={12} /> List</Pill> : null}
                            {lead.has_report ? <Pill tone="sent"><FileText size={12} /> Report</Pill> : null}
                          </div>
                        </TableCell>
                        <TableCell><EmailBadge status={lead.email_status} /></TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()} className="max-w-[160px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {lead.website ? (
                              <a className="max-w-[120px] truncate text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer" title={lead.website}>{lead.domain || lead.website}</a>
                            ) : (
                              <span className="text-xs text-muted-foreground">none</span>
                            )}
                            <StatusPill lead={lead} />
                            <ChatbotBadge lead={lead} />
                          </div>
                          <div className="mt-1"><Socials lead={lead} /></div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Score label="D" value={lead.desktop_performance} />
                            <Score label="M" value={lead.mobile_performance} />
                            <Score label="SEO" value={lead.desktop_seo || lead.mobile_seo} />
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {lead.city || "-"}
                          {lead.country ? <div>{lead.country}</div> : null}
                        </TableCell>
                        <TableCell>
                          <QuickLeadActions lead={lead} onPatch={patchLead} onLists={(l) => setListDialog({ lead: l })} compact />
                          <RowActions
                            lead={lead}
                            busy={{ enrich: busy[`${lead.id}:enrich`], whatsapp: busy[`${lead.id}:whatsapp`], remove: busy[`${lead.id}:remove`], status: busy[`${lead.id}:status`], chatbot: busy[`${lead.id}:chatbot`] }}
                            onEnrich={enrichOne}
                            onWhatsapp={checkWhatsapp}
                            onReport={setReportLead}
                            onRemove={removeLead}
                            onStatus={checkStatusOne}
                            onChatbot={scanChatbotOne}
                            removeTitle={removeTitle}
                          />
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

        {/* Pager */}
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={loading || page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Previous</Button>
          <span className="text-xs text-muted-foreground">{total ? `${pageStart}-${pageEnd} of ${total}` : "0 leads"}</span>
          <Button variant="outline" size="sm" disabled={loading || !hasNextPage} onClick={() => setPage((n) => n + 1)}>Next</Button>
        </div>
      </div>

      {reportLead && <ReportModal lead={reportLead} onClose={() => { setReportLead(null); load(); }} />}
      {listDialog && (
        <ListsDialog
          lead={listDialog.lead}
          ids={listDialog.ids}
          lists={lists}
          onClose={() => setListDialog(null)}
          onSavedLead={mergeLead}
          onChanged={load}
        />
      )}
      {active && (
        <LeadDrawer
          lead={active}
          onClose={() => setActive(null)}
          onPatch={patchLead}
          onStatus={checkStatusOne}
          onChatbot={scanChatbotOne}
          onDeleted={(id) => {
            setActive(null);
            setRows((r) => r.filter((x) => x.id !== id));
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          {toast}
        </div>
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
              {batch.finished ? (
                <CheckCircle2 size={16} className="text-emerald-500" />
              ) : (
                <Loader2 size={16} className="animate-spin text-primary" />
              )}
              {batch.finished
                ? batch.failed
                  ? `${batch.done} of ${batch.total} ${noun}s done`
                  : isAudit ? "All audits done" : "All reports ready"
                : isAudit ? "Auditing sites…" : "Generating reports…"}
            </div>
            {batch.finished && (
              <button
                onClick={() => setBatch(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", batch.finished ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{batch.done} / {batch.total} done{batch.failed ? ` · ${batch.failed} failed` : ""}</span>
            <span>{pct}%</span>
          </div>
          {!batch.finished && batch.latest && (
            <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={batch.latest}>{batch.latest}</p>
          )}
          {batch.finished && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{isAudit ? "Health scores updated on the audited leads." : "Open any lead to view or download its report."}</p>
          )}
        </div>
        );
      })()}
    </AppShell>
  );
}
