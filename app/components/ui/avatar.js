"use client";
import * as React from "react";
import { cn } from "../../lib/utils";

function Avatar({ className, src, alt = "", fallback, ...props }) {
  const [errored, setErrored] = React.useState(false);
  const showImg = src && !errored;
  return (
    <span
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary",
        className
      )}
      {...props}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setErrored(true)} />
      ) : (
        <span>{fallback}</span>
      )}
    </span>
  );
}

export { Avatar };
