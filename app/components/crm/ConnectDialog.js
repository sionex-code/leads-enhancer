"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Connecting and re-configuring are different jobs, so they get different
// dialogs. Connecting should be over in half a minute: paste a key, pick a
// campaign, done. Re-configuring is where field mapping and re-testing live,
// and almost nobody goes there.
export default function ConnectDialog(props) {
  return props.connection ? <EditConnection {...props} /> : <QuickConnect {...props} />;
}

/* ------------------------------------------------------------------ connect */

function QuickConnect({ provider, onClose, onSaved }) {
  const p = provider || {};
  const authFields = p.authFields || [];
  const configFields = p.configFields || [];

  // A remote-select is the one setting worth interrupting for - you cannot send
  // to Smartlead without naming a campaign. Everything else has a working
  // default and belongs behind "Advanced" - unless the adapter marks it
  // `prominent`, which means its default silently costs the user something they
  // would have chosen differently had they seen it (email verification being
  // the case in point: off by default, and not changeable after the push).
  //
  // Memoised because runProbe closes over these: a fresh array each render would
  // reset the debounce timer every render and the probe would never fire.
  const targetFields = useMemo(() => configFields.filter((f) => f.type === "remote-select"), [configFields]);
  const mainFields = useMemo(
    () => configFields.filter((f) => f.type !== "remote-select" && f.prominent),
    [configFields]
  );
  const extraFields = useMemo(
    () => configFields.filter((f) => f.type !== "remote-select" && !f.prominent),
    [configFields]
  );

  const [credentials, setCredentials] = useState({});
  const [config, setConfig] = useState(() => {
    const base = {};
    for (const f of configFields) base[f.key] = f.default ?? "";
    return base;
  });
  const [label, setLabel] = useState("");
  const [probe, setProbe] = useState({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const complete = authFields.every((f) => !f.required || String(credentials[f.key] || "").trim());

  // Only the newest probe is allowed to write state - a slow first attempt must
  // not overwrite the result of the key the user has since corrected.
  const probeSeq = useRef(0);
  // Read, never depended on: picking a campaign changes config, and that must
  // not re-run the probe and re-select it underneath the user.
  const configRef = useRef(config);
  configRef.current = config;

  const runProbe = useCallback(async () => {
    if (!complete) return;
    const seq = ++probeSeq.current;
    setProbe({ state: "checking" });
    try {
      const d = await jsonFetch("/api/crm/probe", {
        method: "POST",
        body: JSON.stringify({ provider: p.id, credentials, config: configRef.current }),
      });
      if (seq !== probeSeq.current) return;
      if (!d.ok) { setProbe({ state: "error", error: d.error }); return; }
      setProbe({ state: "ok", account: d.account, targets: d.targets, targetsError: d.targetsError });
      // One campaign is not a choice. Pick it and let them press Connect.
      if (d.targets?.length === 1 && targetFields.length) {
        setConfig((c) => ({ ...c, [targetFields[0].key]: d.targets[0].value }));
      }
    } catch (e) {
      if (seq !== probeSeq.current) return;
      setProbe({ state: "error", error: e.message });
    }
  }, [complete, credentials, p.id, targetFields]);

  // Typing a key is a paste, so checking as soon as it settles feels instant.
  // A URL is typed character by character, though, and probing a webhook means
  // POSTing to it - so those wait for blur instead of firing at every prefix.
  const autoProbe = !authFields.some((f) => f.type === "url");
  useEffect(() => {
    if (!autoProbe || !complete) return undefined;
    const t = setTimeout(runProbe, 600);
    return () => clearTimeout(t);
    // runProbe changes with every keystroke by design; the timer is what debounces.
  }, [autoProbe, complete, runProbe]);

  const missingTarget = targetFields.find((f) => f.required && !config[f.key]);
  const canConnect = probe.state === "ok" && !missingTarget && !saving;

  async function connect() {
    setSaving(true);
    setError("");
    try {
      // The probe already proved these credentials, and the campaign is chosen,
      // so this row lands complete and usable - no follow-up test, and no 409
      // on the first push.
      const saved = await jsonFetch("/api/crm/connections", {
        method: "POST",
        body: JSON.stringify({ provider: p.id, credentials, config, ...(label.trim() ? { label: label.trim() } : {}) }),
      });
      onSaved?.(saved.connection);
      onClose?.();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect {p.label}</DialogTitle>
          <DialogDescription>{p.blurb}</DialogDescription>
        </DialogHeader>

        {/* DialogHeader and DialogFooter bring their own padding; the body
            between them has none, so it has to bring its own or it runs
            edge to edge. Same pattern as ListsDialog. */}
        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {authFields.map((f) => (
            <div key={f.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`cf-${f.key}`} className="text-xs font-medium text-muted-foreground">
                  {f.label}{f.required ? "" : " (optional)"}
                </label>
                {p.docsUrl && f.required ? (
                  <a href={p.docsUrl} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Where do I find this? <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
              <Input
                id={`cf-${f.key}`}
                type={f.type === "password" ? "password" : "text"}
                placeholder={f.placeholder || ""}
                autoFocus={f === authFields[0]}
                value={credentials[f.key] ?? ""}
                onChange={(e) => setCredentials((c) => ({ ...c, [f.key]: e.target.value }))}
                onBlur={() => { if (!autoProbe) runProbe(); }}
              />
              {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
            </div>
          ))}

          <ProbeStatus probe={probe} label={p.label} complete={complete} autoProbe={autoProbe}
                       onCheck={runProbe} expectsTargets={targetFields.length > 0} />

          {probe.state === "ok" && targetFields.map((f) => (
            <div key={f.key} className="space-y-1">
              <label htmlFor={`ct-${f.key}`} className="text-xs font-medium text-muted-foreground">Send leads to</label>
              {probe.targets?.length ? (
                <Select id={`ct-${f.key}`} value={selectedTarget(config[f.key], probe.targets)}
                        onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}>
                  <option value="">Choose a {f.label.toLowerCase()}</option>
                  <TargetOptions targets={probe.targets} />
                </Select>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  {probe.targetsError || `No ${f.label.toLowerCase()}s in that account yet - create one in ${p.label} first, then reopen this.`}
                </p>
              )}
            </div>
          ))}

          {probe.state === "ok" && mainFields.map((f) => (
            <ConfigField key={f.key} field={f} idPrefix="cm" value={config[f.key]}
                         onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
          ))}

          <details className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 [&[open]]:pb-3">
              <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                Advanced
              </summary>
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <label htmlFor="cf-label" className="text-xs font-medium text-muted-foreground">Name</label>
                  <Input id="cf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.label} />
                  <p className="text-xs text-muted-foreground">Only matters if you connect more than one.</p>
                </div>
                {extraFields.map((f) => (
                  <ConfigField key={f.key} field={f} idPrefix="cx" value={config[f.key]}
                               onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
                ))}
                <p className="text-xs text-muted-foreground">
                  Which lead field feeds which {p.label} field is set from the defaults. Change it later with the pencil icon.
                </p>
            </div>
          </details>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={connect} disabled={!canConnect} title={missingTarget ? `Choose a ${missingTarget.label.toLowerCase()} first` : ""}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A stored destination may predate a provider's move to prefixed target values
// (Instantly now answers "campaign:<id>" so campaigns and lead lists can share
// one picker). Without this an existing connection opens with an empty
// dropdown, which reads as "my campaign was forgotten" and invites the user to
// pick again. Kept provider-agnostic: any target whose value is the stored one
// behind a "<kind>:" prefix is the same destination.
function selectedTarget(value, targets) {
  if (!value || !targets?.length) return value || "";
  if (targets.some((t) => t.value === value)) return value;
  return targets.find((t) => t.value.endsWith(`:${value}`))?.value || value;
}

// The options inside a remote-select. An adapter may tag each target with a
// `group` (Instantly returns campaigns and lead lists together, because it
// makes you pick exactly one of the two); when it does, they render as
// optgroups so the two kinds are not one undifferentiated list. Untagged
// targets stay a flat list, which is every other adapter.
function TargetOptions({ targets }) {
  const groups = [];
  for (const t of targets) {
    const name = t.group || "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(t);
    else groups.push({ name, items: [t] });
  }
  const option = (t) => (
    <option key={t.value} value={t.value}>{t.label}{t.hint ? ` · ${t.hint}` : ""}</option>
  );
  return groups.map((g, i) =>
    g.name
      ? <optgroup key={g.name} label={g.name}>{g.items.map(option)}</optgroup>
      : <Fragment key={`g${i}`}>{g.items.map(option)}</Fragment>
  );
}

// One config setting, rendered the same whether it sits in the body or behind
// "Advanced" - the two used to carry their own copies of this markup and had
// already drifted (only one of them honoured `default`).
function ConfigField({ field: f, idPrefix, value, onChange }) {
  const id = `${idPrefix}-${f.key}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{f.label}</label>
      {f.type === "select" ? (
        <Select id={id} value={value ?? f.default ?? ""} onChange={(e) => onChange(e.target.value)}>
          {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : (
        <Input id={id} value={value ?? f.default ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
    </div>
  );
}

// The one line that tells you whether the key you just pasted works.
function ProbeStatus({ probe, label, complete, autoProbe, onCheck, expectsTargets }) {
  if (probe.state === "checking") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your {label} account…
      </p>
    );
  }
  if (probe.state === "ok") {
    const count = probe.targets?.length;
    return (
      <p className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          Connected{probe.account?.name ? ` · ${probe.account.name}` : ""}
          {/* Not "campaigns": Instantly answers with campaigns and lead lists
              together, so counting them as campaigns would be a lie on the one
              provider where the difference is the whole point. */}
          {count ? ` · ${count} destination${count === 1 ? "" : "s"} found` : ""}
        </span>
      </p>
    );
  }
  if (probe.state === "error") {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{probe.error}</span>
      </p>
    );
  }
  // Idle. When we don't check as you type, say how the check happens.
  if (!autoProbe && complete) {
    return (
      <button type="button" onClick={onCheck} className="text-xs font-medium text-primary hover:underline">
        Check this endpoint
      </button>
    );
  }
  // Otherwise say what is about to happen, so the empty half of the dialog
  // reads as "one more step" rather than as a form that failed to load. Kept
  // as a plain line: the field's own help text sits right above it, and two
  // bordered grey boxes in a row read as clutter.
  return (
    <p className="text-xs text-muted-foreground">
      {expectsTargets
        ? `Where your leads can go loads here as soon as the key checks out.`
        : `We'll check the key against ${label} before anything is saved.`}
    </p>
  );
}

/* --------------------------------------------------------------------- edit */

// Everything the quick path deliberately hides: renaming, re-keying, field
// mapping, and an explicit re-test.
function EditConnection({ provider, connection, sources = [], transforms = [], onClose, onSaved }) {
  const p = provider || {};
  const [tab, setTab] = useState("credentials");
  const [label, setLabel] = useState(connection?.label || p.label || "");
  const [credentials, setCredentials] = useState({});
  const [config, setConfig] = useState(() => {
    const base = {};
    for (const f of p.configFields || []) base[f.key] = connection?.config?.[f.key] ?? f.default ?? "";
    return base;
  });
  const [fieldMap, setFieldMap] = useState(() =>
    connection?.field_map?.length ? connection.field_map : p.defaultFieldMap || []
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [targets, setTargets] = useState(null);
  const [targetsError, setTargetsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setError(""); }, [tab]);

  const needsTargets = (p.configFields || []).some((f) => f.type === "remote-select");

  const loadTargets = useCallback(async (connectionId) => {
    if (!connectionId) return;
    setTargetsError("");
    try {
      const d = await jsonFetch(`/api/crm/connections/${connectionId}/targets`);
      if (!d.ok) { setTargets([]); setTargetsError(d.error || "Could not load the destination list."); return; }
      setTargets(d.targets || []);
      if (!d.targets?.length) setTargetsError("Nothing to send to in that account yet - create a campaign or lead list first.");
    } catch (e) {
      setTargets([]);
      setTargetsError(e.message);
    }
  }, []);

  // The stored credentials already work, so the campaign list can load straight
  // away rather than waiting on a test.
  useEffect(() => {
    if (needsTargets && connection?.status === "ok") loadTargets(connection.id);
  }, [needsTargets, connection?.id, connection?.status, loadTargets]);

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
      // An empty source means "don't send this field" - drop the row entirely
      // rather than storing a mapping that maps to nothing.
      if (!merged.source) return next;
      return [...next, merged];
    });
  }

  function payload() {
    const body = { label, config, fieldMap };
    // Only send credentials the user actually typed: an untouched form must
    // leave the stored token alone.
    if (Object.keys(credentials).length) body.credentials = credentials;
    return body;
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await jsonFetch(`/api/crm/connections/${connection.id}`, {
        method: "PATCH", body: JSON.stringify(payload()),
      });
      onSaved?.(saved.connection);
      onClose?.();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setError("");
    try {
      // Save what's on screen first, so the test exercises the token the user
      // just typed rather than the one still in the database.
      await jsonFetch(`/api/crm/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify(payload()) });
      const t = await jsonFetch(`/api/crm/connections/${connection.id}/test`, { method: "POST" });
      setTestResult(t);
      onSaved?.(t.connection);
      if (t.ok && needsTargets) await loadTargets(connection.id);
    } catch (e) {
      setError(e.message);
    }
    setTesting(false);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {connection.label}</DialogTitle>
          <DialogDescription>{p.blurb}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border px-5">
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

        <div className="max-h-[52vh] space-y-4 overflow-y-auto p-5">
          {tab === "credentials" ? (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.label} />
                <span className="text-xs text-muted-foreground">Yours to recognise it by - you can connect more than one.</span>
              </label>

              {(p.authFields || []).map((f) => (
                <label key={f.key} className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {f.label}{f.required ? "" : " (optional)"}
                  </span>
                  <Input
                    type={f.type === "password" ? "password" : "text"}
                    placeholder={
                      connection?.config?.tokenHint && f.type === "password"
                        ? `Saved ${connection.config.tokenHint} - leave blank to keep it`
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
                  {f.type === "remote-select" ? (
                    targets === null ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        Press <strong className="text-foreground">Test connection</strong> to load the list from your account.
                      </p>
                    ) : (
                      <Select value={selectedTarget(config[f.key], targets)} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}>
                        <option value="">Choose a {f.label.toLowerCase()}</option>
                        <TargetOptions targets={targets} />
                      </Select>
                    )
                  ) : f.type === "select" ? (
                    <Select value={config[f.key] ?? f.default ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}>
                      {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  ) : (
                    <Input value={config[f.key] ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} />
                  )}
                  {f.type === "remote-select" && targetsError
                    ? <span className="block text-xs text-amber-600 dark:text-amber-400">{targetsError}</span>
                    : f.help ? <span className="block text-xs text-muted-foreground">{f.help}</span> : null}
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
                        <option value="">Not sent</option>
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
          <div className={`mx-5 mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
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

        {error ? <p className="mx-5 mb-4 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving || testing}>Cancel</Button>
          <Button variant="outline" onClick={test} disabled={saving || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Test connection
          </Button>
          <Button onClick={save} disabled={saving || testing || !label.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
