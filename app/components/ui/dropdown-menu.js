"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

// Minimal popover menu (no Radix). Click trigger to toggle; click outside or
// pick an item to close.
const MenuCtx = React.createContext({ open: false, setOpen: () => {} });

function DropdownMenu({ children }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <MenuCtx.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative">{children}</div>
    </MenuCtx.Provider>
  );
}

function DropdownMenuTrigger({ asChild, children }) {
  const { open, setOpen } = React.useContext(MenuCtx);
  const toggle = (e) => {
    e.preventDefault();
    setOpen((o) => !o);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: toggle, "aria-expanded": open });
  }
  return (
    <button type="button" onClick={toggle} aria-expanded={open}>
      {children}
    </button>
  );
}

function DropdownMenuContent({ className, align = "end", side = "bottom", children, ...props }) {
  const { open, setOpen } = React.useContext(MenuCtx);
  if (!open) return null;
  return (
    <div
      className={cn(
        "absolute z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95",
        side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        align === "end" ? "right-0" : "left-0",
        className
      )}
      onClick={() => setOpen(false)}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuItem({ className, asChild, children, ...props }) {
  const cls = cn(
    "flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent",
    className
  );
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { className: cn(cls, children.props.className), ...props });
  }
  return (
    <button type="button" className={cls} {...props}>
      {children}
    </button>
  );
}

function DropdownMenuLabel({ className, ...props }) {
  return <div className={cn("px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", className)} {...props} />;
}
function DropdownMenuSeparator({ className, ...props }) {
  return <div className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
