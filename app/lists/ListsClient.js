"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { List, ListPlus, Star, Loader2, ArrowRight, Pencil, Trash2, Check, X } from "lucide-react";
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

// Guided tour for the Lists page. Passed to AppShell as tourKey="lists".
const LISTS_TOUR = [
  { key: "lists-new", title: "Create a list", body: "Name a new list here, then add leads to it from the Leads page." },
  { key: "lists-favorites", title: "Favorites", body: "Favorites is a built-in list of every lead you star — always one click away." },
  { key: "lists-open", title: "Open a list", body: "Click any list to open the Leads table filtered to just those leads." },
];

// Saved lists overview. "Favorites" is a built-in list (the watchlist flag); the
// rest are the user's named lists. Each opens the Leads table filtered to it.
export default function ListsClient() {
  const [lists, setLists] = useState(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState(null);

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

  async function saveRename(id) {
    const clean = editName.trim();
    if (!clean) return;
    setSavingId(id);
    try {
      await jsonFetch(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name: clean }) });
      setEditingId(null);
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteList(id) {
    try {
      await jsonFetch(`/api/lists/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <AppShell active="lists" title="Lists" subtitle="Saved lists of leads" tourKey="lists" tourSteps={LISTS_TOUR}>
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <Card data-tour="lists-new">
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
        <Link href="/leads?workflow=watchlist" className="block" data-tour="lists-favorites">
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
          <div className="grid gap-3 sm:grid-cols-2" data-tour="lists-open">
            {lists.map((l) => {
              const isEditing = editingId === l.id;
              const isSaving = savingId === l.id;

              return (
                <Card key={l.id} className="group transition-all hover:shadow-sm">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <List className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Input
                            size="sm"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRename(l.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="h-8 py-1 px-2 text-sm"
                            autoFocus
                            disabled={isSaving}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/20"
                            onClick={() => saveRename(l.id)}
                            disabled={isSaving || !editName.trim()}
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => setEditingId(null)}
                            disabled={isSaving}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Link href={`/leads?list=${l.id}`} className="block group/link">
                          <div className="truncate text-sm font-semibold group-hover/link:text-primary transition-colors" title={l.name}>
                            {l.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {Number(l.count || 0).toLocaleString()} lead{l.count === 1 ? "" : "s"}
                          </div>
                        </Link>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Rename list"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditingId(l.id);
                            setEditName(l.name);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/15 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete list"
                          onClick={(e) => {
                            e.preventDefault();
                            if (confirm(`Are you sure you want to delete the list "${l.name}"? This won't delete the leads themselves, only the list folder.`)) {
                              deleteList(l.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Link href={`/leads?list=${l.id}`} className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-primary">
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
