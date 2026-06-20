"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "../../lib/utils";

// A tiny (i) button that toggles a popover with explanatory content. No Radix —
// click to open, click outside or Esc to close. Used in table headers (website
// health, owner reply) so the explanation lives behind an icon instead of taking
// up a full row of legend text.
export function InfoPopover({ children, className, label = "More info", align = "left", width = "w-64" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute top-6 z-50 rounded-lg border border-border bg-popover p-3 text-xs font-normal normal-case leading-relaxed text-muted-foreground shadow-lg",
            width,
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
