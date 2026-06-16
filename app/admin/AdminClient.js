"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, RefreshCw, Search, ShieldCheck, Users, Crown, LogOut, Network, Plus, Trash2 } from "lucide-react";
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
const PLAN_LABEL = { p19: "Starter", p49: "Growth", p99: "Scale" };
const PLAN_OPTIONS = [
  { value: "", label: "Free (no plan)" },
  { value: "p19", label: "Starter ($19)" },
  { value: "p49", label: "Growth ($49)" },
  { value: "p99", label: "Scale ($99)" },
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const active = isActive(u);
                  const unlimited = active && (u.leads_quota === null || u.plan === "p99");
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar src={u.image} alt={u.email} fallback={(u.email || "?").slice(0, 1).toUpperCase()} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{u.email || "(no email)"}</div>
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
