"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plug, Webhook, Building2, Handshake, Loader2, CheckCircle2, AlertTriangle,
  Trash2, Pencil, RefreshCw, Send, Mail,
} from "lucide-react";
import AppShell from "../components/app/AppShell";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import ConnectDialog from "../components/crm/ConnectDialog";
import RelativeTime from "../components/RelativeTime";

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

const PROVIDER_ICON = { smartlead: Send, instantly: Mail, webhook: Webhook, hubspot: Building2, pipedrive: Handshake };

const INTEGRATIONS_TOUR = [
  { key: "int-add", title: "Connect a tool", body: "Smartlead and Instantly drop leads straight into a cold-email campaign. HubSpot and Pipedrive are proper CRMs. A plain webhook covers Zapier, Make and n8n, which reach almost anything else. All you need is an API key or a URL." },
  { key: "int-list", title: "Your connections", body: "Test one at any time. If a token stops working the badge turns red here before a push wastes its time." },
  { key: "int-history", title: "Recent pushes", body: "Every send is recorded with how many landed, how many were skipped, and what failed." },
];

function StatusBadge({ status }) {
  if (status === "ok") return <Badge variant="success">Connected</Badge>;
  if (status === "error") return <Badge variant="destructive">Needs attention</Badge>;
  return <Badge variant="secondary">Not tested</Badge>;
}

export default function IntegrationsClient() {
  const [providers, setProviders] = useState([]);
  const [sources, setSources] = useState([]);
  const [transforms, setTransforms] = useState([]);
  const [connections, setConnections] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { provider, connection? }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, c, j] = await Promise.all([
        jsonFetch("/api/crm/providers"),
        jsonFetch("/api/crm/connections"),
        jsonFetch("/api/crm/push?limit=15").catch(() => ({ jobs: [] })),
      ]);
      setProviders(p.providers || []);
      setSources(p.sources || []);
      setTransforms(p.transforms || []);
      setConnections(c.connections || []);
      setConfigured(c.configured !== false);
      setJobs(j.jobs || []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function test(conn) {
    setBusy(`test:${conn.id}`);
    setError("");
    try {
      const r = await jsonFetch(`/api/crm/connections/${conn.id}/test`, { method: "POST" });
      setConnections((cs) => cs.map((c) => (c.id === conn.id ? r.connection || c : c)));
      if (!r.ok) setError(r.error);
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  async function remove(conn) {
    if (!confirm(`Disconnect "${conn.label}"? Leads already in your CRM stay there; only the connection and its sync history are removed.`)) return;
    setBusy(`del:${conn.id}`);
    try {
      await jsonFetch(`/api/crm/connections/${conn.id}`, { method: "DELETE" });
      setConnections((cs) => cs.filter((c) => c.id !== conn.id));
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  const providerFor = (id) => providers.find((p) => p.id === id);

  return (
    <AppShell active="integrations" title="Integrations" subtitle="Send your leads straight into your CRM or cold-email tool"
              tourKey="integrations" tourSteps={INTEGRATIONS_TOUR}>
      {/* AppShell's <main> adds no padding of its own — every page brings its
          own content wrapper (see BillingClient). Without this the sections sit
          flush against the sidebar and stretch the full window width. */}
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
      {!configured && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Integrations aren&apos;t switched on for this server yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Credentials are stored encrypted, and the encryption key (CRM_SECRET_KEY) is missing. Connecting will fail until it&apos;s set.
          </p>
        </div>
      )}

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

      <section data-tour="int-list">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Your connections</h2>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <Plug className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Nothing connected yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Pick one below and you can start sending leads in a minute.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => {
              const Icon = PROVIDER_ICON[c.provider] || Plug;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {providerFor(c.provider)?.label || c.provider}
                      {c.config?.tokenHint ? ` · ${c.config.tokenHint}` : ""}
                      {c.last_push_at ? <> · last push <RelativeTime iso={c.last_push_at} /></> : ""}
                    </p>
                    {c.status === "error" && c.last_error ? (
                      <p className="mt-1 text-xs text-destructive">{c.last_error}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={c.status} />
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" title="Test connection" disabled={busy === `test:${c.id}`} onClick={() => test(c)}>
                      {busy === `test:${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit"
                            onClick={() => setDialog({ provider: providerFor(c.provider), connection: c })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Disconnect" disabled={busy === `del:${c.id}`} onClick={() => remove(c)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section data-tour="int-add">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Add an integration</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => {
            const Icon = PROVIDER_ICON[p.id] || Plug;
            return (
              <div key={p.id} className="flex flex-col rounded-xl border border-border bg-card/40 p-4">
                <Icon className="mb-2 h-6 w-6 text-primary" />
                <p className="text-sm font-semibold text-foreground">{p.label}</p>
                <p className="mt-1 flex-1 text-xs text-muted-foreground">{p.blurb}</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => setDialog({ provider: p })}>
                  Connect
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section data-tour="int-history">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent pushes</h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing sent yet. Select some leads on the <Link href="/leads" className="text-primary hover:underline">Leads</Link> page and choose &ldquo;Send to CRM&rdquo;.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Integration</th>
                  <th className="px-3 py-2 text-right font-medium">Sent</th>
                  <th className="px-3 py-2 text-right font-medium">Skipped</th>
                  <th className="px-3 py-2 text-right font-medium">Failed</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground"><RelativeTime iso={j.created_at} /></td>
                    <td className="px-3 py-2 text-foreground">{j.connection_label || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{j.succeeded}/{j.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{j.skipped || 0}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${j.failed ? "text-destructive" : "text-muted-foreground"}`}>{j.failed || 0}</td>
                    <td className="px-3 py-2">
                      {j.status === "running" || j.status === "queued" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Sending</span>
                      ) : j.status === "done" && !j.failed ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Done</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400" title={j.last_error || ""}>
                          <AlertTriangle className="h-3 w-3" /> {j.status === "done" ? "Partial" : j.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      </div>

      {dialog ? (
        <ConnectDialog
          provider={dialog.provider}
          connection={dialog.connection}
          sources={sources}
          transforms={transforms}
          onClose={() => setDialog(null)}
          onSaved={() => load()}
        />
      ) : null}
    </AppShell>
  );
}
