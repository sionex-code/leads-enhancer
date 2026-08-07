"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// Chrome (and Edge/Brave) block web pages from navigating straight to an
// internal chrome://... URL — a real <a href="chrome://extensions"> link is
// silently ignored. Click-to-copy is the closest thing to "one click" that
// actually works, so this is a button, not a link.
export default function CopyChromeUrl({ url }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — text is still
      // visible for the user to select and copy manually.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-foreground transition hover:bg-muted/70"
      title="Copy to clipboard"
    >
      {url}
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}
