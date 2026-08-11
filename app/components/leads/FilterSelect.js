"use client";

// A filter control with a real dropdown.
//
// This replaces a bare <select> nested inside a styled label. That version
// inherited the OS widget: no room for icons, no check on the active row, a
// native popup that ignores the app's theme, and — worst — the selected value
// rendered in the same weight as the label, so you could not tell an active
// filter from an idle one at a glance. Here the pill itself carries the state
// (bordered and inked when narrowed), and the menu is ordinary DOM we control.

// Shaped as a squared-off control rather than a pill: a row of pills reads as
// tags you might type into, where these are persistent state. The active state
// leans on border + label weight, not a block of brand colour — six tinted
// pills in a row is exactly how a filter bar starts to look like decoration.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export default function FilterSelect({ label, value, options, onChange, icon: Icon, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = value !== "all";
  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
          active
            ? "border-primary/60 bg-primary/[0.06] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]"
            : "border-border bg-card text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
        )}
      >
        {Icon && <Icon size={13} className={active ? "text-primary" : "text-muted-foreground/70"} />}
        <span>{label}</span>
        <span className={cn("font-semibold", active ? "text-primary" : "text-foreground/80")}>
          {current?.label ?? "All"}
        </span>
        <ChevronDown size={12} className={cn("text-muted-foreground/60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-9 z-50 min-w-[170px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                o.value === value ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted"
              )}
            >
              {o.icon ? <o.icon size={13} className="shrink-0" /> : null}
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint === undefined || o.hint === null ? null : (
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{o.hint}</span>
              )}
              {o.value === value && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
