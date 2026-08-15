"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plug, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";

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

  async function loadPreview(next) {
    setShowPreview(next);
    if (!next || preview || !chosen) return;
    try {
      // The same target the Send button will use, so the preview describes the
      // leads actually going out rather than an unrelated one off the top of
      // the account.
      const d = await jsonFetch(`/api/crm/connections/${chosen}/preview`, {
        method: "POST",
        body: JSON.stringify({ ...target }),
      });
      setPreview(d);
    } catch (e) { setPreview({ error: e.message }); }
  }

  async function send() {
    setSending(true);
    setError("");
    try {
      const d = await jsonFetch("/api/crm/push", {
        method: "POST",
        body: JSON.stringify({ connectionId: chosen, skipUnchanged, ...target }),
      });
      onStarted?.(d);
      onClose?.();
    } catch (e) {
      setError(e.message);
      setSending(false);
    }
  }

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
          <div className="space-y-3">
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

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="mt-0.5" checked={skipUnchanged} onChange={(e) => setSkipUnchanged(e.target.checked)} />
              <span>Skip leads that haven&apos;t changed since their last successful push.</span>
            </label>

            <div>
              <button type="button" onClick={() => loadPreview(!showPreview)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {showPreview ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Preview what gets sent
              </button>
              {showPreview ? (
                <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5">
                  {!preview ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : preview.error ? (
                    <p className="text-xs text-destructive">{preview.error}</p>
                  ) : (
                    <>
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Example - {preview.sample?.name}
                        {preview.checked > 1 ? ` (1 of ${preview.checked} checked)` : ""}
                      </p>
                      <pre className="overflow-x-auto text-[11px] leading-relaxed text-foreground">
{JSON.stringify(preview.mapped, null, 2)}
                      </pre>
                      {preview.warnings?.length ? (
                        <ul className="mt-2 space-y-0.5">
                          {preview.warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !chosen || !connections?.length}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
