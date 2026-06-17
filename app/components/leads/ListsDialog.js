"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Always refresh the list catalog (and, for a single lead, its current
  // membership) when the dialog opens.
  useEffect(() => {
    jsonFetch("/api/lists").then((d) => setAllLists(d.lists || [])).catch(() => {});
    if (lead) {
      jsonFetch(`/api/leads/${lead.id}/lists`).then((d) => setChecked(new Set(d.listIds || []))).catch(() => {});
    }
  }, [lead]);

  const toggle = (id) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function createList() {
    const name = newName.trim();
    if (!name) return;
    setError("");
    try {
      const d = await jsonFetch("/api/lists", { method: "POST", body: JSON.stringify({ name }) });
      setAllLists((ls) => (ls.some((l) => l.id === d.list.id) ? ls : [...ls, { ...d.list, count: 0 }].sort((a, b) => a.name.localeCompare(b.name))));
      setChecked((s) => new Set(s).add(d.list.id));
      setNewName("");
      onChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (bulk) {
        await jsonFetch("/api/leads/lists/bulk", {
          method: "POST",
          body: JSON.stringify({ ids, listIds: [...checked] }),
        });
      } else {
        const d = await jsonFetch(`/api/leads/${lead.id}/lists`, { method: "PUT", body: JSON.stringify({ listIds: [...checked] }) });
        if (d.lead) onSavedLead?.(d.lead);
      }
      onChanged?.();
      onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{bulk ? `Add ${ids.length} lead${ids.length === 1 ? "" : "s"} to lists` : "Lists"}</DialogTitle>
          <DialogDescription>{bulk ? "Pick the list(s) to add the selected leads to." : "Choose which lists this lead belongs to."}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] space-y-1.5 overflow-auto py-1">
          {allLists.length === 0 && <p className="text-sm text-muted-foreground">No lists yet — create one below.</p>}
          {allLists.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
              <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} className="accent-[hsl(var(--primary))]" />
              <span className="flex-1">{l.name}</span>
              <span className="text-xs text-muted-foreground">{l.count}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="New list name…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createList(); } }} />
          <Button variant="outline" onClick={createList} disabled={!newName.trim()}>Create</Button>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || (bulk && checked.size === 0)}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} {bulk ? "Add to list" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
