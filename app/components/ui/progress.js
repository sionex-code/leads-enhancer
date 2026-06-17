"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

const Progress = React.forwardRef(({ className, value = 0, indicatorClassName, ...props }, ref) => {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-[width] duration-500 ease-out", indicatorClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});
Progress.displayName = "Progress";

export { Progress };
