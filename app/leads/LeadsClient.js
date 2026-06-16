"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../components/app/AppShell";
import AnimatedNumber from "../components/AnimatedNumber";
import ReportModal from "../components/ReportModal";
import {
  Ban,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { cn } from "../lib/utils";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const PAGE_SIZE = 120;
const REPORT_COST = 10; // credits per website report (mirrors billing.REPORT_COST)

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

// Inline per-row contact actions: grab email/socials, check WhatsApp, open the
// website report, and remove. Remove is context-aware (see removeLead in parent):
// in a watch/custom-list view it just drops the lead from that view; in the full
// leads view it deletes permanently.
function RowActions({ lead, busy = {}, onEnrich, onWhatsapp, onReport, onRemove, onStatus, onChatbot, removeTitle }) {
  const wa = waState(lead);
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
      <Button variant="ghost" size="icon" className="h-8 w-8" title="Website report" disabled={!lead.website} onClick={() => onReport(lead)}>
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
              {lead.phone && <div className="flex items-center gap-2"><Phone size={13} className="text-muted-foreground" /> {lead.phone} {waState(lead) === "yes" && <Pill tone="good">WA yes</Pill>}{waState(lead) === "no" && <Pill tone="bad">WA no</Pill>}</div>}
              {lead.email && <div className="flex items-center gap-2"><Mail size={13} className="text-muted-foreground" /> <a className="text-primary hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></div>}
              {lead.all_emails && lead.all_emails !== lead.email && <div className="text-xs text-muted-foreground">Also: {lead.all_emails}</div>}
              {lead.address && <div className="flex items-center gap-2"><MapPin size={13} className="text-muted-foreground" /> {lead.address}</div>}
              {lead.website && <div className="flex items-center gap-2"><ExternalLink size={13} className="text-muted-foreground" /> <a className="text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.domain || lead.website}</a></div>}
              {lead.maps_url && <div><a className="text-primary hover:underline" href={lead.maps_url} target="_blank" rel="noreferrer">Open on Google Maps</a></div>}
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

// Add/remove a lead (or a bulk selection) to named lists. Single-lead mode edits
// membership (checkboxes pre-filled); bulk mode adds the selected leads to the
// checked lists. Either mode can create a new list inline.
function ListsDialog({ lead, ids, lists, onClose, onSavedLead, onChanged }) {
  const bulk = !lead && Array.isArray(ids);
  const [allLists, setAllLists] = useState(lists || []);
  const [checked, setChecked] = useState(() => new Set());
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (lead) {
      jsonFetch(`/api/leads/${lead.id}/lists`).then((d) => setChecked(new Set(d.listIds || []))).catch(() => {});
    }
  }, [lead]);

  const toggle = (id) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function createList() {
    const name = newName.trim();
    if (!name) return;
    setError("");
    try {
      const d = await jsonFetch("/api/lists", { method: "POST", body: JSON.stringify({ name }) });
      setAllLists((ls) => (ls.some((l) => l.id === d.list.id) ? ls : [...ls, { ...d.list, count: 0 }].sort((a, b) => a.name.localeCompare(b.name))));
      setChecked((s) => new Set(s).add(d.list.id));
      setNewName("");
      onChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (bulk) {
        for (const listId of checked) {
          await jsonFetch("/api/leads/lists/bulk", { method: "POST", body: JSON.stringify({ ids, listId }) });
        }
      } else {
        const d = await jsonFetch(`/api/leads/${lead.id}/lists`, { method: "PUT", body: JSON.stringify({ listIds: [...checked] }) });
        if (d.lead) onSavedLead?.(d.lead);
      }
      onChanged?.();
      onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{bulk ? `Add ${ids.length} lead${ids.length === 1 ? "" : "s"} to lists` : "Lists"}</DialogTitle>
          <DialogDescription>{bulk ? "Pick the list(s) to add the selected leads to." : "Choose which lists this lead belongs to."}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] space-y-1.5 overflow-auto py-1">
          {allLists.length === 0 && <p className="text-sm text-muted-foreground">No lists yet — create one below.</p>}
          {allLists.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
              <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} className="accent-[hsl(var(--primary))]" />
              <span className="flex-1">{l.name}</span>
              <span className="text-xs text-muted-foreground">{l.count}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="New list name…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createList(); } }} />
          <Button variant="outline" onClick={createList} disabled={!newName.trim()}>Create</Button>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || (bulk && checked.size === 0)}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} {bulk ? "Add to list" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  // Bulk report selection + the user's live credit balance (for the cost warning).
  const [selected, setSelected] = useState(() => new Set());
  const [credits, setCredits] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Live progress for an in-flight bulk-report batch (replaces the old fire-and-
  // forget alert). { total, done, failed, latest, finished, jobIds }.
  const [reportBatch, setReportBatch] = useState(null);
  const batchPollRef = useRef(null);
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

  // Poll every job in a bulk-report batch and roll the per-job progress up into a
  // single { done / total } figure for the progress panel. Each report job exposes
  // `sites` (planned) and `results` (completed), so done = Σ results, total = Σ sites.
  const pollBatch = useCallback((jobIds, total) => {
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
      // "failed" only makes sense once every job has settled: any reports that
      // never landed (total − done). Mid-flight that gap is just work in progress.
      const failed = allTerminal ? Math.max(0, total - done) : 0;
      setReportBatch({ jobIds, total, done, failed, latest, finished: allTerminal });
      if (allTerminal) {
        refreshCredits();
      } else {
        batchPollRef.current = setTimeout(tick, 2500);
      }
    };
    tick();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate website reports for the selected leads. Charges REPORT_COST each;
  // confirms cost vs. balance first, then runs them as background jobs and shows
  // a live progress panel that polls each job to completion.
  const bulkReport = useCallback(async () => {
    const ids = rows.filter((r) => r.website && selected.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    const cost = ids.length * REPORT_COST;
    const have = credits ?? 0;
    if (cost > have) {
      alert(`Not enough credits. ${ids.length} report(s) need ${cost} credits and you have ${have}. Reduce your selection or top up in Billing.`);
      return;
    }
    if (!confirm(`Generate ${ids.length} website report(s)?\n\nThis will use ${cost} credits (${ids.length} × ${REPORT_COST}). You have ${have}, leaving ${have - cost}.`)) return;
    setBulkBusy(true);
    try {
      const data = await jsonFetch("/api/leads/report/bulk", { method: "POST", body: JSON.stringify({ ids }) });
      if (typeof data.credits === "number") setCredits(data.credits);
      setSelected(new Set());
      const jobIds = data.jobIds || [];
      setReportBatch({ jobIds, total: data.count, done: 0, failed: 0, latest: "Starting…", finished: false });
      if (jobIds.length) pollBatch(jobIds, data.count);
    } catch (err) {
      refreshCredits();
      alert(err.message);
    } finally {
      setBulkBusy(false);
    }
  }, [rows, selected, credits, refreshCredits, pollBatch]);

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
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const notEnoughCredits = credits != null && reportCost > credits;
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

        {/* Bulk action bar — add to a list, or generate reports (with credit cost) */}
        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
            <span className="font-medium">{selectedCount} selected</span>
            {reportableCount > 0 && (
              <span className="text-muted-foreground">
                Reports: {reportableCount} × {REPORT_COST} = <strong className="text-foreground">{reportCost} credits</strong>
                {credits != null && <> · balance {credits}</>}
                {notEnoughCredits && <span className="ml-2 font-medium text-red-600">Not enough credits</span>}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
              <Button variant="outline" size="sm" onClick={() => setListDialog({ ids: [...selected] })}><ListPlus size={15} /> Add to list</Button>
              <Button size="sm" disabled={bulkBusy || reportableCount === 0 || notEnoughCredits} onClick={bulkReport}>
                {bulkBusy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                Generate {reportableCount} report{reportableCount === 1 ? "" : "s"}
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
                {rows.map((lead) => (
                  <div className="cursor-pointer rounded-lg border border-border bg-card/60 p-3" key={`m-${lead.id}`} onClick={() => setActive(lead)}>
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
                        <strong className="text-sm font-medium">{lead.name || "Unknown"}</strong>
                      </div>
                      <span className="text-xs text-muted-foreground">{lead.category || lead.address || lead.project || ""}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <WorkflowBadge lead={lead} />
                      <EmailBadge status={lead.email_status} />
                      {lead.watchlist ? <Pill tone="watch"><Star size={12} fill="currentColor" /> Favorite</Pill> : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                      {lead.phone && <span>{lead.phone}</span>}
                      {waState(lead) === "yes" && <Pill tone="good">WA yes</Pill>}
                      {lead.domain && <span className="text-xs text-muted-foreground">{lead.domain}</span>}
                    </div>
                    {lead.email && <div className="mt-1 truncate text-sm text-primary">{lead.email}</div>}
                    {lead.notes && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{lead.notes}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusPill lead={lead} />
                      <ChatbotBadge lead={lead} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                      <QuickLeadActions lead={lead} onPatch={patchLead} onLists={(l) => setListDialog({ lead: l })} compact />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
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
                    </div>
                  </div>
                ))}
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
                      <TableHead>Lead</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Website</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((lead) => (
                      <TableRow key={lead.id} className="cursor-pointer" onClick={() => setActive(lead)}>
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
                        <TableCell>
                          <div className="font-medium">{lead.name || "Unknown"}</div>
                          <div className="text-xs text-muted-foreground">{lead.category || lead.address || ""}</div>
                          {lead.notes && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{lead.notes}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {lead.phone || "-"}
                            {waState(lead) === "yes" && <Pill tone="good">WA yes</Pill>}
                            {waState(lead) === "no" && <Pill tone="bad">WA no</Pill>}
                          </div>
                          {lead.email ? <a onClick={(e) => e.stopPropagation()} className="text-xs text-primary hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="text-xs text-muted-foreground">{lead.enrich_status || "no email"}</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <WorkflowBadge lead={lead} />
                            {lead.watchlist ? <Pill tone="watch"><Star size={12} fill="currentColor" /> Favorite</Pill> : null}
                            {lead.contact_list ? <Pill tone="contact"><Users size={12} /> List</Pill> : null}
                          </div>
                        </TableCell>
                        <TableCell><EmailBadge status={lead.email_status} /></TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {lead.website ? <a className="text-primary hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.domain || lead.website}</a> : <span className="text-xs text-muted-foreground">none</span>}
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
                    ))}
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

      {reportLead && <ReportModal lead={reportLead} onClose={() => setReportLead(null)} />}
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

      {/* Live bulk-report progress: a fixed card that polls every job to completion. */}
      {reportBatch && (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-card p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {reportBatch.finished ? (
                <CheckCircle2 size={16} className="text-emerald-500" />
              ) : (
                <Loader2 size={16} className="animate-spin text-primary" />
              )}
              {reportBatch.finished
                ? reportBatch.failed
                  ? `${reportBatch.done} of ${reportBatch.total} reports ready`
                  : "All reports ready"
                : "Generating reports…"}
            </div>
            {reportBatch.finished && (
              <button
                onClick={() => setReportBatch(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", reportBatch.finished ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${reportBatch.total ? Math.round((reportBatch.done / reportBatch.total) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{reportBatch.done} / {reportBatch.total} done{reportBatch.failed ? ` · ${reportBatch.failed} failed` : ""}</span>
            <span>{reportBatch.total ? Math.round((reportBatch.done / reportBatch.total) * 100) : 0}%</span>
          </div>
          {!reportBatch.finished && reportBatch.latest && (
            <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={reportBatch.latest}>{reportBatch.latest}</p>
          )}
          {reportBatch.finished && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">Open any lead to view or download its report.</p>
          )}
        </div>
      )}
    </AppShell>
  );
}
