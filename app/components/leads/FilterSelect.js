"use client";

// A filter pill with a real dropdown.
//
// This replaces a bare <select> nested inside a styled label. That version
// inherited the OS widget: no room for icons, no check on the active row, a
// native popup that ignores the app's theme, and — worst — the selected value
// rendered in the same weight as the label, so you could not tell an active
// filter from an idle one at a glance. Here the pill itself carries the state
// (tinted when narrowed), and the menu is ordinary DOM we control.

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
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
          active
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border text-muted-foreground hover:bg-muted/60"
        )}
      >
        {Icon && <Icon size={13} className={active ? "text-primary" : ""} />}
        <span>{label}</span>
        <span className={cn("font-semibold", active ? "text-primary" : "text-foreground")}>
          {current?.label ?? "All"}
        </span>
        <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
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
