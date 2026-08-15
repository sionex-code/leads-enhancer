"use client";

import { CheckCircle2, Loader2, AlertTriangle, ArrowUpCircle } from "lucide-react";

// Live "is it connected yet?" badge. This page is the one place where that
// answer matters, and the one place they're actively installing.
//
// Presentational only - InstallGuide owns the polling hook, because it also
// needs the answer (to collapse the steps once the extension is in) and two
// independent pollers would be two independent sources of truth.
//
// Colour carries the icon and the border only. The text itself stays on
// `foreground`/`muted-foreground`, because tinted text (emerald-300) on a tinted
// background was effectively unreadable in the light theme.
export default function ExtensionStatus({ checking, installed, version, outdated, latestVersion }) {
  if (checking) {
    return (
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking for the extension…</p>
      </div>
    );
  }

  if (installed && outdated) {
    return (
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-sky-500/40 bg-sky-500/[0.08] px-4 py-3.5">
        <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Update available, you&apos;re on v{version}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {latestVersion ? `v${latestVersion} is out. ` : ""}Download it again and
            load it over the same folder - no need to remove the old one first.
          </p>
        </div>
      </div>
    );
  }

  if (installed) {
    return (
      <div className="mt-8 flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-4 py-3.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Connected, extension v{version}
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
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Not installed yet</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Follow the four steps below. It takes about two minutes, and this badge
          turns green on its own the moment the extension connects.
        </p>
      </div>
    </div>
  );
}
