"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, Plus, ListPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

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

// Shared "Add to list" dialog used by both the Leads manager and the dashboard so
// the experience is identical everywhere. Single-lead mode edits membership
// (checkboxes pre-filled); bulk mode adds the selected leads to the checked lists.
// Either mode can create a new list inline. Lists are loaded from /api/lists if a
// `lists` prop isn't supplied, so callers without a preloaded list still work.
export default function ListsDialog({ lead, ids, lists, onClose, onSavedLead, onChanged }) {
  const bulk = !lead && Array.isArray(ids);
  const [allLists, setAllLists] = useState(lists || []);
  const [checked, setChecked] = useState(() => new Set());
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Always refresh the list catalog (and, for a single lead, its current
  // membership) when the dialog opens.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      jsonFetch("/api/lists").then((d) => d.lists || []).catch(() => []),
      lead ? jsonFetch(`/api/leads/${lead.id}/lists`).then((d) => d.listIds || []).catch(() => []) : Promise.resolve([]),
    ]).then(([ls, listIds]) => {
      if (!alive) return;
      setAllLists(ls);
      if (lead) setChecked(new Set(listIds));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [lead]);

  const toggle = (id) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function createList() {
    const name = newName.trim();
    if (!name) return;
    setError("");
    setCreating(true);
    try {
      const d = await jsonFetch("/api/lists", { method: "POST", body: JSON.stringify({ name }) });
      setAllLists((ls) => (ls.some((l) => l.id === d.list.id) ? ls : [...ls, { ...d.list, count: 0 }].sort((a, b) => a.name.localeCompare(b.name))));
      setChecked((s) => new Set(s).add(d.list.id));
      setNewName("");
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
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

  const title = bulk
    ? `Add ${ids.length} lead${ids.length === 1 ? "" : "s"} to lists`
    : "Add to list";
  const subtitle = bulk
    ? "Pick the list(s) to add the selected leads to."
    : lead?.name
      ? <>Choose which lists <span className="font-medium text-foreground">{lead.name}</span> belongs to.</>
      : "Choose which lists this lead belongs to.";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ListPlus size={18} className="text-primary" /> {title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[42vh] space-y-1 overflow-auto py-1 pr-0.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading your lists…
            </div>
          ) : allLists.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              No lists yet — create your first one below.
            </div>
          ) : (
            allLists.map((l) => {
              const on = checked.has(l.id);
              return (
                <button
                  type="button"
                  key={l.id}
                  onClick={() => toggle(l.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    on ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                  )}
                >
                  <span className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                  )}>
                    {on && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate font-medium">{l.name}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {l.count ?? 0}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex gap-2 border-t border-border pt-3">
          <Input
            placeholder="New list name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createList(); } }}
          />
          <Button variant="outline" onClick={createList} disabled={!newName.trim() || creating} className="shrink-0">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Create
          </Button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || (bulk && checked.size === 0)}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {bulk ? (checked.size ? `Add to ${checked.size} list${checked.size === 1 ? "" : "s"}` : "Add to list") : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
