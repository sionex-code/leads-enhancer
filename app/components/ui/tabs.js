"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

// Lightweight controlled tabs (no Radix).
const TabsCtx = React.createContext({ value: undefined, onValueChange: () => {} });

function Tabs({ value, onValueChange, className, children, ...props }) {
  return (
    <TabsCtx.Provider value={{ value, onValueChange }}>
      <div className={className} {...props}>{children}</div>
    </TabsCtx.Provider>
  );
}

function TabsList({ className, ...props }) {
  return (
    <div
      className={cn("inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 text-muted-foreground", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, value, children, ...props }) {
  const ctx = React.useContext(TabsCtx);
  const active = ctx.value === value;
  return (
    <button
      type="button"
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx.onValueChange?.(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        active ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { Tabs, TabsList, TabsTrigger };
