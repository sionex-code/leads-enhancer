"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpCircle, X } from "lucide-react";
import useExtension from "../lib/useExtension";

// Shown across the top of every app page when the connected extension is older
// than the build we currently publish.
//
// It lives here rather than only on /extension because an outdated extension is
// not something anybody goes looking for — the scraper keeps working, so the
// only signal a user ever gets is a search behaving oddly. The account menu's
// status dot is too quiet to carry that on its own.
//
// Dismissal is remembered against the version it was dismissed for, so "not
// now" silences this build only: the next release raises it again instead of
// being permanently muted by one click.
const DISMISS_KEY = "lf_ext_update_dismissed";

export default function ExtensionUpdateBanner() {
  const { outdated, version, latestVersion } = useExtension();
  const [dismissed, setDismissed] = useState(null);
  // /extension makes the same point in far more detail, with the download
  // button right there. Two prompts on one screen just reads as noise.
  const onExtensionPage = usePathname() === "/extension";

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) || "");
    } catch {
      setDismissed("");
    }
  }, []);

  // `dismissed === null` means localStorage hasn't been read yet. Rendering
  // before then would flash the banner for anyone who already dismissed it.
  if (onExtensionPage || !outdated || dismissed === null || dismissed === latestVersion) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, latestVersion || "");
    } catch {}
    setDismissed(latestVersion || "");
  };

  return (
    <div className="flex items-center gap-3 border-b border-sky-500/30 bg-sky-500/[0.08] px-4 py-2.5 md:px-6">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-sky-600" />
      <p className="min-w-0 flex-1 text-sm text-foreground">
        <span className="font-semibold">Extension update available.</span>{" "}
        <span className="text-muted-foreground">
          You&apos;re on v{version}
          {latestVersion ? `, v${latestVersion} is out` : ""}. Updating takes about
          thirty seconds.
        </span>
      </p>
      <Link
        href="/extension"
        className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"
      >
        Update now
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss until the next release"
        title="Dismiss until the next release"
        className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
