"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plug, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Select } from "../ui/select";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Request failed: ${res.status}`); err.code = data.code; throw err; }
  return data;
}

// Choose where the selected leads go.
//
// `target` is { mode, ids?, list?, filters? } - the same three ways of naming a
// selection that CSV export uses, so "send what I'm looking at" and "export what
// I'm looking at" can never disagree.
export default function PushToCrmDialog({ target, count, onClose, onStarted }) {
  const [connections, setConnections] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [skipUnchanged, setSkipUnchanged] = useState(true);
  // Per-push overrides, keyed by connection id so switching between two
  // connections does not carry one's answer over to the other.
  const [overrides, setOverrides] = useState({});
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    jsonFetch("/api/crm/connections")
      .then((d) => {
        const list = d.connections || [];
        setConnections(list);
        setChosen(list.find((c) => c.status !== "error")?.id ?? null);
      })
      .catch((e) => { setConnections([]); setError(e.message); });
  }, []);

  // Fetched as soon as a connection is picked, not only when the preview is
  // expanded: the warnings decide whether pressing Send does anything at all,
  // and a user who never opens the disclosure is exactly the one who most needs
  // to be told the push would send nothing. The JSON payload stays collapsed.
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    setPreview(null);
    // The same target the Send button will use, so the preview describes the
    // leads actually going out rather than an unrelated one off the top of
    // the account.
    jsonFetch(`/api/crm/connections/${chosen}/preview`, {
      method: "POST",
      body: JSON.stringify({ ...target }),
    })
      .then((d) => { if (!cancelled) setPreview(d); })
      .catch((e) => { if (!cancelled) setPreview({ error: e.message }); });
    return () => { cancelled = true; };
    // `target` is rebuilt by the parent on every render; the dialog is opened
    // against one fixed selection, so keying off the connection is correct and
    // depending on `target` would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  async function send() {
    setSending(true);
    setError("");
    try {
      const d = await jsonFetch("/api/crm/push", {
        method: "POST",
        body: JSON.stringify({
          connectionId: chosen,
          skipUnchanged,
          configOverride: overrides[chosen] || {},
          ...target,
        }),
      });
      onStarted?.(d);
      onClose?.();
    } catch (e) {
      setError(e.message);
      setSending(false);
    }
  }

  const chosenConn = connections?.find((c) => c.id === chosen) || null;

  // Every sampled lead is missing a field the CRM requires, so the push would
  // run, skip all of them and report success having sent nobody. Worth blocking
  // rather than warning: there is no version of pressing Send that helps.
  const nothingToSend = !!preview && !preview.error
    && preview.checked > 0 && preview.blocked === preview.checked;

  const scope = target?.mode === "ids"
    ? `${count ?? target.ids?.length ?? 0} selected lead${(count ?? target.ids?.length) === 1 ? "" : "s"}`
    : target?.mode === "list"
      ? "every lead in this list"
      : "every lead matching your current filters";

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to CRM</DialogTitle>
          <DialogDescription>Sending {scope}.</DialogDescription>
        </DialogHeader>

        {connections === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your integrations…
          </p>
        ) : connections.length === 0 ? (
          // Never hide the button when nothing is connected - this empty state
          // is how most people will discover the feature exists at all.
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <Plug className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No CRM connected yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect HubSpot, Pipedrive, or any webhook - it takes about a minute.
            </p>
            <Button asChild className="mt-3" size="sm">
              <Link href="/integrations">Set up an integration</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Destination</p>
            <ul className="space-y-1.5">
              {connections.map((c) => {
                const broken = c.status === "error";
                return (
                  <li key={c.id}>
                    <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                      broken ? "cursor-not-allowed border-border opacity-60" : "cursor-pointer border-border hover:bg-accent"
                    } ${chosen === c.id ? "border-primary bg-primary/5" : ""}`}>
                      <input
                        type="radio"
                        name="crm-connection"
                        className="mt-1"
                        disabled={broken}
                        checked={chosen === c.id}
                        onChange={() => { setChosen(c.id); setPreview(null); }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{c.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {broken ? c.last_error || "Needs reconnecting" : c.provider}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Options</p>

              {(chosenConn?.pushFields || []).map((f) => {
                const value = overrides[chosen]?.[f.key]
                  ?? chosenConn?.config?.[f.key] ?? f.default ?? "";
                return (
                  <div key={f.key} className="space-y-1">
                    <label htmlFor={`po-${f.key}`} className="text-xs font-medium text-foreground">{f.label}</label>
                    {f.type === "select" ? (
                      <Select id={`po-${f.key}`} value={value}
                              onChange={(e) => setOverrides((o) => ({
                                ...o, [chosen]: { ...(o[chosen] || {}), [f.key]: e.target.value },
                              }))}>
                        {(f.options || []).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </Select>
                    ) : null}
                    {f.help ? <p className="text-[11px] leading-relaxed text-muted-foreground">{f.help}</p> : null}
                  </div>
                );
              })}

              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="mt-0.5" checked={skipUnchanged} onChange={(e) => setSkipUnchanged(e.target.checked)} />
                <span>Skip leads that haven&apos;t changed since their last successful push.</span>
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What gets sent</p>

              {nothingToSend ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0 text-xs">
                    <p className="font-medium text-destructive">This push would send nothing.</p>
                    <p className="mt-0.5 text-muted-foreground">
                      None of the {preview.checked} leads checked have the fields{" "}
                      {chosenConn?.provider || "this CRM"} requires. Enrich them first so they have
                      an email, then send.
                    </p>
                  </div>
                </div>
              ) : preview?.warnings?.length ? (
                <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                  {preview.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}
                    </li>
                  ))}
                </ul>
              ) : preview?.error ? (
                <p className="text-xs text-destructive">{preview.error}</p>
              ) : !preview ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking your leads…
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  All {preview.checked} leads checked have what {chosenConn?.provider || "this CRM"} needs.
                </p>
              )}

              {preview && !preview.error ? (
                <>
                  <button type="button" onClick={() => setShowPreview((v) => !v)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {showPreview ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Example payload
                  </button>
                  {showPreview ? (
                    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {preview.sample?.name}
                        {preview.checked > 1 ? ` (1 of ${preview.checked} checked)` : ""}
                      </p>
                      <pre className="overflow-x-auto text-[11px] leading-relaxed text-foreground">
{JSON.stringify(preview.mapped, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )}

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !chosen || !connections?.length || nothingToSend}
                  title={nothingToSend ? "None of these leads have the fields this CRM requires" : ""}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
