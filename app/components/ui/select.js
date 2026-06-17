"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

// Native <select> styled to match the shadcn aesthetic — no Radix dependency.
// Pass children as <option> elements, same API as a normal select.
const Select = React.forwardRef(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full appearance-none rounded-md border border-input bg-background/60 px-3 pr-9 py-2 text-sm text-foreground shadow-sm transition-colors",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </div>
));
Select.displayName = "Select";

export { Select };
