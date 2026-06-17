"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

// Controlled toggle built on a checkbox (no Radix).
const Switch = React.forwardRef(({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={!!checked}
    disabled={disabled}
    onClick={() => onCheckedChange?.(!checked)}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-primary" : "bg-input",
      className
    )}
    {...props}
  >
    <span
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5"
      )}
    />
  </button>
));
Switch.displayName = "Switch";

export { Switch };
