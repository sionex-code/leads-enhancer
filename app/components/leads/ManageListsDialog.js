"use client";

// Create / rename / delete the user's saved lists, without leaving the leads
// table. This used to be a page of its own (/lists) whose only other job was
// linking back into this table filtered by list - two nav entries for one task,
// where picking a list and managing lists lived on opposite sides of a
// navigation. Now the filter dropdown sits next to a "Manage" button that opens
// this, and /lists redirects here.
//
// Deleting a list never deletes leads: the list is a folder, the leads stay in
// the database. Favorites is not shown, because it is the watchlist flag rather
// than a real list - it can't be renamed or deleted.

import { useState } from "react";
import { Check, List, ListPlus, Loader2, Pencil, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent } from "../ui/dialog";

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

export default function ManageListsDialog({ lists = [], onClose, onChanged, activeListId = "", onDeletedActive }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

  const run = async (key, fn) => {
    setBusy(key);
    setError("");
    try {
      await fn();
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    return run("create", async () => {
      await jsonFetch("/api/lists", { method: "POST", body: JSON.stringify({ name: clean }) });
      setName("");
    });
  };

  const rename = (id) => {
    const clean = editName.trim();
    if (!clean) return;
    return run(`edit:${id}`, async () => {
      await jsonFetch(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name: clean }) });
      setEditingId(null);
    });
  };

  const remove = (list) => {
    if (!confirm(`Delete the list "${list.name}"? The leads in it stay in your database - only the list is removed.`)) return;
    return run(`del:${list.id}`, async () => {
      await jsonFetch(`/api/lists/${list.id}`, { method: "DELETE" });
      // The table is currently filtered to a list that no longer exists, so drop
      // the filter rather than leaving it showing an empty result forever.
      if (String(activeListId) === String(list.id)) onDeletedActive?.();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-md p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><List size={16} /> Manage lists</h2>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New list name"
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <Button disabled={!name.trim() || busy === "create"} onClick={create}>
            {busy === "create" ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />} Create
          </Button>
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {lists.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No lists yet. Create one above, then add leads to it from the table.
            </p>
          ) : (
            lists.map((l) => {
              const editing = editingId === l.id;
              return (
                <div key={l.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                  {editing ? (
                    <>
                      <Input
                        value={editName}
                        autoFocus
                        className="h-8 px-2 py-1 text-sm"
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(l.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" disabled={!editName.trim() || busy === `edit:${l.id}`} onClick={() => rename(l.id)}>
                        {busy === `edit:${l.id}` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setEditingId(null)}>
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={l.name}>{l.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {Number(l.count || 0).toLocaleString()} lead{Number(l.count) === 1 ? "" : "s"}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Rename"
                        onClick={() => { setEditingId(l.id); setEditName(l.name); }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        title="Delete list"
                        disabled={busy === `del:${l.id}`}
                        onClick={() => remove(l)}
                      >
                        {busy === `del:${l.id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </Button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
