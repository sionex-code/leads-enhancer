"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, RefreshCw, Search, ShieldCheck, Users, Crown, LogOut, Network, Plus, Trash2, Ban, CreditCard, Activity, Tag, Check, CircleDot, Database } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Avatar } from "../components/ui/avatar";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { cn } from "../lib/utils";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
// Keys MUST match billing.cjs (p19 Starter · p35 Growth · p49 Scale). The old
// p49→Growth / p99→Scale mapping was wrong and made "Scale" fail with an Invalid
// plan error (p99 doesn't exist) while silently mislabelling p49.
const PLAN_LABEL = { p19: "Starter", p35: "Growth", p49: "Scale" };
const PLAN_OPTIONS = [
  { value: "", label: "Free (no plan)" },
  { value: "p19", label: "Starter ($19)" },
  { value: "p35", label: "Growth ($35)" },
  { value: "p49", label: "Scale ($49)" },
];

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function isActive(u) {
  return u.status === "active" && (!u.current_period_end || Date.parse(u.current_period_end) > Date.now());
}

// Mask the password in a proxy url for display (admin-only view, but tidy).
function maskProxy(url) {
  return String(url || "").replace(/(\/\/[^:/@]+:)[^@]+@/, "$1***@");
}

// Global scraper proxy pool. Paste HTTPS proxies (one per line); the scrapers pick
// a random one per request so they don't reuse the same IP.
function ProxyManager() {
  const [proxies, setProxies] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch("/api/admin/proxies");
      setProxies(d.proxies || []);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setErr("");
    try {
      const d = await jsonFetch("/api/admin/proxies", { method: "POST", body: JSON.stringify({ urls: text }) });
      setProxies(d.proxies || []);
      setText("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id, enabled) {
    setProxies((l) => l.map((p) => (p.id === id ? { ...p, enabled } : p)));
    try {
      await jsonFetch("/api/admin/proxies", { method: "PATCH", body: JSON.stringify({ id, enabled }) });
    } catch {
      load();
    }
  }

  async function remove(id) {
    setProxies((l) => l.filter((p) => p.id !== id));
    try {
      await jsonFetch("/api/admin/proxies", { method: "DELETE", body: JSON.stringify({ id }) });
    } catch (e) {
      setErr(e.message);
      load();
    }
  }

  const enabledCount = proxies.filter((p) => p.enabled).length;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><Network className="h-4.5 w-4.5" /></div>
          <div>
            <h2 className="text-sm font-semibold">Scraper proxy pool</h2>
            <p className="text-xs text-muted-foreground">{proxies.length ? `${enabledCount}/${proxies.length} enabled · random proxy per request` : "No proxies — scrapers connect directly"}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Textarea
            rows={3}
            placeholder={"Paste HTTPS proxies, one per line:\nhttp://user:pass@host:port\n203.0.113.10:8080"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button size="sm" disabled={busy || !text.trim()} onClick={add}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add proxies
          </Button>
        </div>

        {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-600">{err}</div>}

        {proxies.length > 0 && (
          <div className="space-y-1.5">
            {proxies.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <label className="flex flex-1 items-center gap-2 truncate">
                  <input
                    type="checkbox"
                    checked={!!p.enabled}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    className="accent-[hsl(var(--primary))]"
                  />
                  <span className={cn("truncate font-mono text-xs", !p.enabled && "text-muted-foreground line-through")}>{maskProxy(p.url)}</span>
                </label>
                {p.fail_count > 0 && <span className="shrink-0 text-xs text-amber-600">{p.fail_count} fails</span>}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => remove(p.id)} title="Remove proxy">
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function relTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Live view of every queued/running scrape across all users. Auto-refreshes.
function OperationsMonitor() {
  const [ops, setOps] = useState([]);
  const [max, setMax] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch("/api/admin/operations");
      setOps(d.operations || []);
      setMax(d.maxConcurrent || 0);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const running = ops.filter((o) => o.status === "running").length;
  const queued = ops.filter((o) => o.status === "queued").length;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><Activity className="h-5 w-5" /></div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Running operations</h3>
            <p className="text-xs text-muted-foreground">{running} running{max ? ` / ${max} slots` : ""} · {queued} queued</p>
          </div>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={15} /></Button>
        </div>
        {loading && !ops.length ? (
          <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : ops.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing running right now.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {ops.map((o) => (
              <div key={o.id} className="flex items-center gap-3 py-2">
                <CircleDot className={cn("h-4 w-4 shrink-0", o.status === "running" ? "animate-pulse text-emerald-500" : "text-amber-500")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.project || "(project)"} <span className="font-normal text-muted-foreground">· {o.type}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{o.email || o.userId}</div>
                </div>
                <Badge variant={o.status === "running" ? "success" : "secondary"} className="shrink-0">{o.status}</Badge>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{relTime(o.startedAt || o.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Edit the displayed monthly price + credit grant for each package.
function PackagePricing() {
  const [pkgs, setPkgs] = useState([]);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch("/api/admin/packages");
      setPkgs(d.packages || []);
      setDraft(Object.fromEntries((d.packages || []).map((p) => [p.id, { price: p.price, credits: p.credits }])));
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(id) {
    setBusy(id);
    setSaved("");
    try {
      const d = await jsonFetch("/api/admin/packages", { method: "POST", body: JSON.stringify({ id, price: draft[id]?.price, credits: draft[id]?.credits }) });
      setPkgs((list) => list.map((p) => (p.id === id ? d.package : p)));
      setSaved(id);
      setTimeout(() => setSaved(""), 2000);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><Tag className="h-5 w-5" /></div>
          <div>
            <h3 className="text-sm font-semibold">Package pricing</h3>
            <p className="text-xs text-muted-foreground">Monthly price &amp; credit grant per plan. Charges are processed by Whop.</p>
          </div>
        </div>
        <div className="space-y-2">
          {pkgs.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <div className="w-24 text-sm font-medium">{p.label} <span className="text-xs text-muted-foreground">{p.id}</span></div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">$
                <Input type="number" className="h-8 w-20" value={draft[p.id]?.price ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], price: e.target.value } }))} />
                /mo
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Input type="number" className="h-8 w-24" value={draft[p.id]?.credits ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], credits: e.target.value } }))} />
                credits
              </label>
              <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => save(p.id)} className="ml-auto">
                {busy === p.id ? <Loader2 size={15} className="animate-spin" /> : saved === p.id ? <Check size={15} className="text-emerald-600" /> : null} Save
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Controls whether lead queries are served from the warehouse only, or fall back
// to a real-time scrape when the warehouse has no results.
const SOURCE_OPTIONS = [
  { value: "warehouse", label: "Warehouse only", desc: "Serve leads from the pre-built warehouse. Never triggers a live scrape." },
  { value: "warehouse_fallback", label: "Warehouse + realtime fallback", desc: "Try warehouse first; fall back to a live Google Maps scrape when empty." },
];

function LeadSourceSettings() {
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch("/api/admin/settings");
      setMode(d.lead_source_mode || "warehouse");
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(value) {
    setBusy(true);
    setSaved(false);
    setErr("");
    try {
      await jsonFetch("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ lead_source_mode: value }),
      });
      setMode(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><Database className="h-5 w-5" /></div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Lead source mode</h3>
            <p className="text-xs text-muted-foreground">Controls how search results are served to users.</p>
          </div>
          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check size={14} /> Saved
            </span>
          )}
          {busy && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
        </div>

        {mode === null && !err ? (
          <div className="py-2 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {SOURCE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  mode === opt.value ? "border-primary/50 bg-primary/5" : "border-border hover:bg-accent/40"
                )}
              >
                <input
                  type="radio"
                  name="lead_source_mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  disabled={busy}
                  onChange={() => save(opt.value)}
                  className="mt-0.5 accent-[hsl(var(--primary))]"
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-600">{err}</div>}
      </CardContent>
    </Card>
  );
}

function StatCard({ icon: Icon, value, label }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminClient() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await jsonFetch("/api/admin/users");
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setPlan(userId, plan) {
    setBusyId(userId);
    setError("");
    try {
      const data = await jsonFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ userId, plan: plan || null }),
      });
      const ent = data.entitlement || {};
      setUsers((list) =>
        list.map((u) =>
          u.id === userId
            ? { ...u, plan: ent.plan, status: ent.active ? "active" : "inactive", leads_quota: ent.quota, leads_used: ent.used, current_period_end: null }
            : u
        )
      );
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId("");
    }
  }

  // Add or remove credits (prompt for a signed delta, e.g. 500 or -200).
  async function adjustCredits(u) {
    const raw = prompt(`Adjust credits for ${u.email || u.id}\nCurrent balance: ${u.credits || 0}\n\nEnter an amount to add (negative to remove):`, "");
    if (raw == null) return;
    const amount = Math.trunc(Number(raw));
    if (!amount || Number.isNaN(amount)) return;
    setBusyId(u.id);
    try {
      const d = await jsonFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ userId: u.id, action: "credits", mode: "add", amount }) });
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, credits: d.credits } : x)));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId("");
    }
  }

  // Ban / unban an account (blocks every protected route for that user).
  async function toggleBan(u) {
    const banned = !u.banned;
    if (banned && !confirm(`Suspend ${u.email || u.id}? They won't be able to use the app until unbanned.`)) return;
    setBusyId(u.id);
    try {
      const d = await jsonFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ userId: u.id, action: "ban", banned }) });
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, banned: d.banned ? 1 : 0 } : x)));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId("");
    }
  }

  async function logout() {
    try {
      await fetch(`${BASE_PATH}/api/admin/login`, { method: "DELETE" });
    } catch {}
    router.refresh();
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? users.filter((u) => (u.email || "").toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q))
    : users;
  const activeCount = users.filter(isActive).length;

  return (
    <div className="lf min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
        <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={128} height={25} priority />
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Admin</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}><LogOut size={16} /> Log out</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold">Manage user plans</h1>
          <p className="text-sm text-muted-foreground">Grant, change or revoke a plan for any account. Changes apply immediately.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <StatCard icon={Users} value={users.length} label="Total users" />
          <StatCard icon={Crown} value={activeCount} label="Active plans" />
        </div>

        {/* Live operations across all users + editable package pricing + lead source. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <OperationsMonitor />
          <PackagePricing />
        </div>
        <LeadSourceSettings />

        <Card>
          <CardContent className="p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search by email or name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </CardContent>
        </Card>

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-600">{error}</div>}

        <Card className="overflow-hidden">
          {!filtered.length ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{loading ? "Loading users..." : "No users found."}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Current plan</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead className="w-[220px]">Set plan</TableHead>
                  <TableHead className="w-[200px]">Credits &amp; access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const active = isActive(u);
                  // Scale (p49) is the unlimited tier — its quota is stored as null.
                  const unlimited = active && (u.leads_quota === null || u.plan === "p49");
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar src={u.image} alt={u.email} fallback={(u.email || "?").slice(0, 1).toUpperCase()} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{u.email || "(no email)"}</span>
                              {u.banned ? <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]"><Ban className="h-2.5 w-2.5" /> Suspended</Badge> : null}
                            </div>
                            {u.name ? <div className="truncate text-xs text-muted-foreground">{u.name}</div> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {active ? (
                          <Badge variant="success" className="gap-1"><Crown className="h-3 w-3" /> {PLAN_LABEL[u.plan] || u.plan}</Badge>
                        ) : (
                          <Badge variant="secondary">Free</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {!active ? "no plan" : unlimited ? "Unlimited" : `${Number(u.leads_used || 0).toLocaleString()} / ${Number(u.leads_quota || 0).toLocaleString()}`}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select
                            value={active && u.plan ? u.plan : ""}
                            disabled={busyId === u.id}
                            onChange={(e) => setPlan(u.id, e.target.value)}
                          >
                            {PLAN_OPTIONS.map((o) => (
                              <option key={o.value || "free"} value={o.value}>{o.label}</option>
                            ))}
                          </Select>
                          {busyId === u.id && <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5 text-sm">
                            <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium tabular-nums">{Number(u.credits || 0).toLocaleString()}</span>
                            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={busyId === u.id} onClick={() => adjustCredits(u)}>Adjust</Button>
                          </div>
                          <Button
                            variant={u.banned ? "secondary" : "ghost"}
                            size="sm"
                            className={cn("h-6 w-fit px-1.5 text-xs", u.banned ? "text-foreground" : "text-red-600 hover:text-red-600")}
                            disabled={busyId === u.id}
                            onClick={() => toggleBan(u)}
                          >
                            <Ban size={13} /> {u.banned ? "Unban" : "Ban"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Admin-granted plans never expire and reset the user's usage to zero.
        </p>

        <div className="pt-2">
          <h2 className="mb-3 text-lg font-semibold">Scraper proxies</h2>
          <ProxyManager />
        </div>
      </main>
    </div>
  );
}
