"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { List, ListPlus, Star, Loader2, ArrowRight } from "lucide-react";
import AppShell from "../components/app/AppShell";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// Saved lists overview. "Favorites" is a built-in list (the watchlist flag); the
// rest are the user's named lists. Each opens the Leads table filtered to it.
export default function ListsClient() {
  const [lists, setLists] = useState(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => jsonFetch("/api/lists").then((d) => setLists(d.lists || [])).catch(() => setLists([]));
  useEffect(() => { load(); }, []);

  async function createList() {
    const clean = name.trim();
    if (!clean) return;
    setCreating(true);
    try {
      await jsonFetch("/api/lists", { method: "POST", body: JSON.stringify({ name: clean }) });
      setName("");
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell active="lists" title="Lists" subtitle="Saved lists of leads">
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <ListPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list name" className="pl-9" onKeyDown={(e) => e.key === "Enter" && createList()} />
            </div>
            <Button disabled={!name.trim() || creating} onClick={createList}>
              {creating ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />} Create list
            </Button>
          </CardContent>
        </Card>

        {/* Built-in Favorites list */}
        <Link href="/leads?workflow=watchlist" className="block">
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600"><Star className="h-5 w-5" fill="currentColor" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Favorites</div>
                <div className="text-xs text-muted-foreground">Leads you starred</div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        {lists === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : lists.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No saved lists yet. Create one above, then add leads to it from the Leads page.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lists.map((l) => (
              <Link key={l.id} href={`/leads?list=${l.id}`} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><List className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold" title={l.name}>{l.name}</div>
                      <div className="text-xs text-muted-foreground">{Number(l.count || 0).toLocaleString()} lead{l.count === 1 ? "" : "s"}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
