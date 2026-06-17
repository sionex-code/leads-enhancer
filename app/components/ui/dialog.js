"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

// Lightweight controlled modal (no Radix). Usage:
//   <Dialog open={open} onOpenChange={setOpen}>
//     <DialogContent>...</DialogContent>
//   </Dialog>
const DialogCtx = React.createContext({ onOpenChange: () => {} });

function Dialog({ open, onOpenChange, children }) {
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
  return <DialogCtx.Provider value={{ onOpenChange }}>{children}</DialogCtx.Provider>;
}

const DialogContent = React.forwardRef(({ className, children, showClose = true, ...props }, ref) => {
  const { onOpenChange } = React.useContext(DialogCtx);
  return (
    <div className="lf fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm animate-in fade-in-0"
        onClick={() => onOpenChange?.(false)}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl",
          className
        )}
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
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }) {
  return <div className={cn("flex flex-col gap-1.5 border-b border-border/60 p-5 pr-12", className)} {...props} />;
}
function DialogTitle({ className, ...props }) {
  return <h2 className={cn("text-lg font-semibold leading-tight tracking-tight", className)} {...props} />;
}
function DialogDescription({ className, ...props }) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
function DialogFooter({ className, ...props }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border/60 p-4", className)} {...props} />;
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
