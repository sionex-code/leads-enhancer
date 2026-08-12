"use client";

import { useCallback, useRef, useState } from "react";
import { Globe, Loader2, Upload } from "lucide-react";
import LeadsClient from "../leads/LeadsClient";
import ExtensionRequiredDialog from "../components/ExtensionRequiredDialog";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { detectExtension, enrichDomains, versionAtLeast, MIN_DOMAIN_FINDER_VERSION } from "../lib/extension-client";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const MAX_DOMAINS = 200;

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// One domain per line/comma; strip protocol + path + query so duplicates like
// "https://foo.com" and "foo.com/contact" collapse to the same entry.
function parseDomains(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(/[\n,]/)) {
    let s = raw.trim().toLowerCase();
    if (!s) continue;
    s = s.replace(/^https?:\/\//, "").split(/[/?#\s]/)[0].replace(/^www\./, "");
    if (!s || !s.includes(".") || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export default function DomainFinderClient() {
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState("");
  const [needExtension, setNeedExtension] = useState(false);
  const [needUpdate, setNeedUpdate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef(null);

  const domains = parseDomains(text);
  const overLimit = domains.length > MAX_DOMAINS;

  const onImportFile = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText((prev) => (prev ? prev + "\n" + String(reader.result || "") : String(reader.result || "")));
    };
    reader.readAsText(file);
  }, []);

  const runScan = useCallback(async () => {
    setError("");
    const list = parseDomains(text).slice(0, MAX_DOMAINS);
    if (!list.length) {
      setError("Enter at least one domain.");
      return;
    }

    const version = await detectExtension();
    if (!version) {
      setNeedExtension(true);
      return;
    }
    // An already-installed older extension answers PING fine (that part never
    // changed) but silently drops ENRICH_DOMAINS — its bridge doesn't forward
    // a message type it doesn't know, so the page would otherwise wait for a
    // RESULT that's never coming. Catch that here instead of just spinning.
    if (version !== "unknown" && !versionAtLeast(version, MIN_DOMAIN_FINDER_VERSION)) {
      setNeedUpdate(true);
      return;
    }

    setScanning(true);
    setProgress({ done: 0, total: list.length });
    try {
      const { rows } = await enrichDomains(list, {
        onProgress: ({ done, total }) => setProgress({ done: done || 0, total: total || list.length }),
      });
      const data = await jsonFetch("/api/domain-finder/scan", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setText("");
      setRefreshKey((k) => k + 1);
      if (data.stored < list.length) {
        setError(`Saved ${data.saved} of ${list.length} domains.`);
      }
    } catch (err) {
      setError(err.message || "Domain scan failed");
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [text]);

  const topPanel = (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Find leads from domains</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste a single domain or up to {MAX_DOMAINS} URLs (one per line), or import a .txt/.csv file.
          Runs in your browser via the LeadsFunda extension — emails, socials, and tracking pixels are
          pulled from each site with a 10-second timeout per domain.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"example.com\nanother-business.com\nhttps://third-site.com"}
          rows={4}
          disabled={scanning}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".txt,.csv" className="hidden" onChange={onImportFile} />
          <Button variant="outline" size="sm" disabled={scanning} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} /> Import file
          </Button>
          <Button size="sm" disabled={scanning || !domains.length || overLimit} onClick={runScan}>
            {scanning ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
            {scanning
              ? progress?.total
                ? `Scanning ${progress.done}/${progress.total}`
                : "Scanning…"
              : `Find leads${domains.length ? ` (${domains.length})` : ""}`}
          </Button>
          <span className="text-xs text-muted-foreground">
            {overLimit ? `Max ${MAX_DOMAINS} domains — trim the list.` : domains.length ? `${domains.length} domain${domains.length === 1 ? "" : "s"} ready` : ""}
          </span>
        </div>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </CardContent>
    </Card>
  );

  return (
    <>
      <ExtensionRequiredDialog
        open={needExtension}
        onClose={() => setNeedExtension(false)}
        title="Install the browser extension to find domain leads"
        body="Domain Leads Finder crawls each site from your own browser through our free Chrome extension, so scanning never loads our servers. It takes about a minute to set up, once."
      />
      <ExtensionRequiredDialog
        open={needUpdate}
        onClose={() => setNeedUpdate(false)}
        title="Update the browser extension to use Domain Leads Finder"
        body="You have an older version of the LeadsFunda extension installed that doesn't support this feature yet. Go to chrome://extensions, find LeadsFunda Lead Scraper, and click Reload — then try again."
      />
      <LeadsClient
        key={refreshKey}
        pageTitle="Domain Leads Finder"
        activeNav="domain-finder"
        source="domain_finder"
        topPanel={topPanel}
      />
    </>
  );
}
