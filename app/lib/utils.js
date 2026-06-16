import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn class-name helper: merge conditional + conflicting Tailwind classes.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
