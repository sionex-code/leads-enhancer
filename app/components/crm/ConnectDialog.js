"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

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

// Connect a new integration, or edit an existing one.
//
// Two tabs rather than one long form: pasting a token and deciding which lead
// column becomes "company name" are different jobs, and most people only ever
// do the first.
export default function ConnectDialog({ provider, connection, sources = [], transforms = [], onClose, onSaved }) {
  const editing = !!connection;
  const [tab, setTab] = useState("credentials");
  const [label, setLabel] = useState(connection?.label || provider?.label || "");
  const [credentials, setCredentials] = useState({});
  const [config, setConfig] = useState(() => {
    const base = {};
    for (const f of provider?.configFields || []) base[f.key] = connection?.config?.[f.key] ?? f.default ?? "";
    return base;
  });
  const [fieldMap, setFieldMap] = useState(() =>
    connection?.field_map?.length ? connection.field_map : provider?.defaultFieldMap || []
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setError(""); }, [tab]);

  // Field map as a lookup so each target row can find its own entry.
  const byTarget = useMemo(() => {
    const m = new Map();
    for (const entry of fieldMap) m.set(entry.target, entry);
    return m;
  }, [fieldMap]);

  function setMapping(target, patch) {
    setFieldMap((prev) => {
      const next = prev.filter((e) => e.target !== target);
      const current = prev.find((e) => e.target === target) || { target, source: "", transform: "none" };
      const merged = { ...current, ...patch };
      // An empty source means "don't send this field" — drop the row entirely
      // rather than storing a mapping that maps to nothing.
      if (!merged.source) return next;
      return [...next, merged];
    });
  }

  async function save({ thenTest } = {}) {
    setSaving(true);
    setError("");
    try {
      const body = { label, config, fieldMap };
      // Only send credentials the user actually typed: on an edit, an untouched
      // form must leave the stored token alone.
      if (Object.keys(credentials).length) body.credentials = credentials;

      let saved;
      if (editing) {
        saved = await jsonFetch(`/api/crm/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        saved = await jsonFetch("/api/crm/connections", {
          method: "POST",
          body: JSON.stringify({ ...body, provider: provider.id, credentials: credentials }),
        });
      }
      if (thenTest) {
        const t = await jsonFetch(`/api/crm/connections/${saved.connection.id}/test`, { method: "POST" });
        setTestResult(t);
        onSaved?.(t.connection || saved.connection);
        setSaving(false);
        return;
      }
      onSaved?.(saved.connection);
      onClose?.();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  async function test() {
    // Testing needs a stored connection, so an unsaved form saves first. Saving
    // an unverified connection is fine — it lands as "unverified" and the test
    // result decides its badge.
    if (!editing) return save({ thenTest: true });
    setTesting(true);
    setError("");
    try {
      // Save what's on screen first, so the test exercises the token the user
      // just typed rather than the one still in the database.
      await jsonFetch(`/api/crm/connections/${connection.id}`, {
        method: "PATCH",
        body: JSON.stringify({ label, config, fieldMap, ...(Object.keys(credentials).length ? { credentials } : {}) }),
      });
      const t = await jsonFetch(`/api/crm/connections/${connection.id}/test`, { method: "POST" });
      setTestResult(t);
      onSaved?.(t.connection);
    } catch (e) {
      setError(e.message);
    }
    setTesting(false);
  }

  const p = provider || {};

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${connection.label}` : `Connect ${p.label}`}</DialogTitle>
          <DialogDescription>{p.blurb}</DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex gap-1 border-b border-border">
          {[["credentials", "Connection"], ["mapping", "Field mapping"]].map(([key, text]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
          {tab === "credentials" ? (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.label} />
                <span className="text-xs text-muted-foreground">Yours to recognise it by — you can connect more than one.</span>
              </label>

              {(p.authFields || []).map((f) => (
                <label key={f.key} className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {f.label}{f.required ? "" : " (optional)"}
                  </span>
                  <Input
                    type={f.type === "password" ? "password" : "text"}
                    placeholder={
                      editing && connection?.config?.tokenHint && f.type === "password"
                        ? `Saved ${connection.config.tokenHint} — leave blank to keep it`
                        : f.placeholder || ""
                    }
                    value={credentials[f.key] ?? ""}
                    onChange={(e) => setCredentials((c) => ({ ...c, [f.key]: e.target.value }))}
                  />
                  {f.help ? <span className="block text-xs text-muted-foreground">{f.help}</span> : null}
                </label>
              ))}

              {p.docsUrl ? (
                <a href={p.docsUrl} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                  Where do I find this? <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}

              {(p.configFields || []).map((f) => (
                <label key={f.key} className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
                  {f.type === "select" ? (
                    <Select value={config[f.key] ?? f.default ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}>
                      {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  ) : (
                    <Input value={config[f.key] ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} />
                  )}
                  {f.help ? <span className="block text-xs text-muted-foreground">{f.help}</span> : null}
                </label>
              ))}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Which lead field feeds each {p.label} field. Leave a row blank to leave that field alone.
              </p>
              <div className="space-y-2">
                {(p.mappableFields || []).map((f) => {
                  const entry = byTarget.get(f.key);
                  return (
                    <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)] items-center gap-2">
                      <span className="truncate text-sm text-foreground">
                        {f.label}
                        {f.required ? <span className="text-destructive"> *</span> : null}
                      </span>
                      <Select value={entry?.source || ""} onChange={(e) => setMapping(f.key, { source: e.target.value })} className="h-9">
                        <option value="">— not sent —</option>
                        {sources.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </Select>
                      <Select
                        value={entry?.transform || "none"}
                        onChange={(e) => setMapping(f.key, { transform: e.target.value })}
                        className="h-9"
                        disabled={!entry?.source}
                      >
                        {transforms.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                      </Select>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setFieldMap(p.defaultFieldMap || [])}
                className="text-xs font-medium text-primary hover:underline"
              >
                Reset to defaults
              </button>
            </>
          )}
        </div>

        {testResult ? (
          <div className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm ${
            testResult.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"
          }`}>
            {testResult.ok
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
            <span className="text-foreground">
              {testResult.ok
                ? `Connected${testResult.account?.name ? ` to ${testResult.account.name}` : ""}.`
                : testResult.error}
            </span>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving || testing}>Cancel</Button>
          <Button variant="outline" onClick={test} disabled={saving || testing}>
            {testing || (saving && testResult === null) ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Test connection
          </Button>
          <Button onClick={() => save()} disabled={saving || testing || !label.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
