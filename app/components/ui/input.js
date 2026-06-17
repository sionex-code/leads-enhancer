"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef(({ className, type = "text", ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm text-foreground shadow-sm transition-colors",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
