"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

// Slide-over panel (no Radix). Controlled via open/onOpenChange.
const SheetCtx = React.createContext({ onOpenChange: () => {} });

function Sheet({ open, onOpenChange, children }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onOpenChange?.(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return <SheetCtx.Provider value={{ onOpenChange }}>{children}</SheetCtx.Provider>;
}

const sideClass = {
  right: "right-0 top-0 h-full w-full max-w-md border-l animate-in slide-in-from-right",
  left: "left-0 top-0 h-full w-60 max-w-[65%] border-r animate-in slide-in-from-left",
};

const SheetContent = React.forwardRef(({ className, children, side = "right", showClose = true, ...props }, ref) => {
  const { onOpenChange } = React.useContext(SheetCtx);
  return (
    <div className="lf fixed inset-0 z-50">
      <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm animate-in fade-in-0" onClick={() => onOpenChange?.(false)} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn("fixed z-50 flex flex-col bg-card text-card-foreground border-border shadow-2xl transition ease-in-out duration-300", sideClass[side], className)}
        {...props}
      >
        {showClose && (
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            className="absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
});
SheetContent.displayName = "SheetContent";

export { Sheet, SheetContent };
