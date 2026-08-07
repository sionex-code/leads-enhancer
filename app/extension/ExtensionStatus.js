"use client";

import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import useExtension from "../lib/useExtension";

// Live "is it connected yet?" badge. Polls so the user doesn't have to guess
// whether the install worked — this page is the one place where that answer
// matters, and the one place they're actively installing.
//
// Colour carries the icon and the border only. The text itself stays on
// `foreground`/`muted-foreground`, because tinted text (emerald-300) on a tinted
// background was effectively unreadable in the light theme.
export default function ExtensionStatus() {
  const { checking, installed, version } = useExtension({ poll: true });

  if (checking) {
    return (
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking for the extension…</p>
      </div>
    );
  }

  if (installed) {
    return (
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-4 py-3.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Connected — extension v{version}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Live searches will run in this browser. You&apos;re all set.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Not detected yet</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Follow the steps below. This updates on its own once the extension
          connects — you may need to reload the page after installing.
        </p>
      </div>
    </div>
  );
}
