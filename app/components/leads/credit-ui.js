"use client";

import Link from "next/link";
import { AlertTriangle, CreditCard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";

// Colour a remaining balance by how much of its full allotment is left:
//   < 20% remaining → danger (red), < 40% → warn (amber), else ok.
// `max` falsy / value null (e.g. unlimited plan) → always ok.
export function balanceTone(value, max) {
  if (value == null || !max || max <= 0) return "ok";
  const pct = value / max;
  if (pct < 0.2) return "danger";
  if (pct < 0.4) return "warn";
  return "ok";
}

// Pill (border + bg + text) classes per tone — used by the balance chips.
export const TONE_PILL = {
  ok: "border-border bg-card/60 text-foreground",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  danger: "border-red-500/50 bg-red-500/10 text-red-600",
};

// Plain text colour per tone — for inline numbers.
export const TONE_TEXT = {
  ok: "text-foreground",
  warn: "text-amber-600",
  danger: "text-red-600",
};

// Progress-bar indicator colour per tone.
export const TONE_BAR = {
  ok: "bg-primary",
  warn: "bg-amber-500",
  danger: "bg-red-500",
};

// Shown whenever an action is blocked for lack of credits / leads. Single shared
// component so the "you're out" experience is identical across scrape, audit and
// report. `info` flag softens it to a neutral notice (e.g. a capped run).
export function InsufficientModal({ open, onClose, title, message, detail, info = false }) {
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className={info ? "text-amber-500" : "text-red-500"} />
            {title || "Not enough credits"}
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{info ? "Got it" : "Close"}</Button>
          {!info && (
            <Button asChild>
              <Link href="/billing"><CreditCard className="h-4 w-4" /> Manage plan</Link>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
