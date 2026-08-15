"use client";
import * as React from "react";
import { createPortal } from "react-dom";
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
  // Must render into <body>, not in place. Every page is wrapped by app/template.js
  // in `animate-page-in`, whose keyframes end on `transform: translateY(0)` with
  // fill-mode `both` - so a real transform stays on that div forever. A transformed
  // ancestor becomes the containing block for `position: fixed` children, which
  // pinned this panel to the top of the *page* instead of the viewport: `h-full`
  // stretched it to the full document height and its header sat wherever the top
  // of the page was. Scrolled a few rows down a long lead table, opening a lead
  // showed nothing but the panel's blank white middle. (Same trap the workspace's
  // BottomDock hit.) Portalling to <body> steps outside that subtree.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
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
    </div>,
    document.body
  );
});
SheetContent.displayName = "SheetContent";

export { Sheet, SheetContent };
