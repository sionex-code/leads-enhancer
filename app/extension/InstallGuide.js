"use client";

import { useEffect, useState } from "react";
import {
  Download,
  Info,
  Smartphone,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import useExtension from "../lib/useExtension";
import useBrowser, { BROWSERS } from "./useBrowser";
import ExtensionStatus from "./ExtensionStatus";
import CopyChromeUrl from "./CopyChromeUrl";
import ExtensionsPageDiagram from "./ExtensionsPageDiagram";

const ZIP_NAME = "leadsfunda-extension.zip";
const FOLDER_NAME = "leadsfunda-extension";
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "";

function Code({ children }) {
  return (
    // A folder name broken across two lines reads as two different folders,
    // which is the one thing these instructions can least afford.
    <code className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
      {children}
    </code>
  );
}

function Callout({ tone = "info", icon: Icon = Info, children }) {
  const tones = {
    info: "border-border bg-muted/50",
    warn: "border-amber-500/40 bg-amber-500/[0.07]",
  };
  const iconTones = { info: "text-muted-foreground", warn: "text-amber-600" };
  return (
    <div className={`mt-3 flex gap-2.5 rounded-lg border px-3 py-2.5 ${tones[tone]}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTones[tone]}`} />
      <div className="min-w-0 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

// Unzipping is the only step where the operating system genuinely changes the
// instruction, and it is also where installs most often go wrong — so it gets
// its own step and its own wording per OS rather than a vague "unzip it".
const UNZIP = {
  windows: (
    <>
      Open your <strong className="text-foreground">Downloads</strong> folder,
      right-click <Code>{ZIP_NAME}</Code>, choose{" "}
      <strong className="text-foreground">Extract All…</strong>, then{" "}
      <strong className="text-foreground">Extract</strong>.
    </>
  ),
  mac: (
    <>
      Open your <strong className="text-foreground">Downloads</strong> folder and
      double-click <Code>{ZIP_NAME}</Code>. A folder named{" "}
      <Code>{FOLDER_NAME}</Code> appears next to it.
    </>
  ),
  linux: (
    <>
      Right-click <Code>{ZIP_NAME}</Code> in your{" "}
      <strong className="text-foreground">Downloads</strong> folder and choose{" "}
      <strong className="text-foreground">Extract Here</strong>.
    </>
  ),
  other: (
    <>
      Unzip <Code>{ZIP_NAME}</Code> so you end up with a real folder named{" "}
      <Code>{FOLDER_NAME}</Code> on disk.
    </>
  ),
};

function OtherBrowsers({ currentId }) {
  const others = Object.entries(BROWSERS).filter(
    ([id, b]) => b.url && id !== "unknown" && id !== currentId,
  );
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
        Installing in a different browser?
      </summary>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
        {others.map(([id, b]) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{b.name}</span>
            <CopyChromeUrl url={b.url} />
          </span>
        ))}
      </div>
    </details>
  );
}

function steps(browser) {
  return [
    {
      title: "Download the extension",
      body: (
        <>
          <a
            href={`/${ZIP_NAME}`}
            download
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Download {ZIP_NAME}
          </a>
          <p className="mt-2 text-sm text-muted-foreground">
            It&apos;s a small file — around 100&nbsp;KB — and lands in your
            Downloads folder.
          </p>
        </>
      ),
    },
    {
      title: "Unzip it",
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            {browser.ready ? UNZIP[browser.os] || UNZIP.other : UNZIP.other}
          </p>
          <Callout tone="warn" icon={AlertTriangle}>
            Extract it properly — don&apos;t just double-click the zip and browse
            around inside it. Your browser can&apos;t load an extension from
            inside a zip, and the preview window it opens is a temporary
            location that disappears.
          </Callout>
          <Callout>
            Keep the extracted folder. Your browser re-reads it every time it
            starts, so moving or deleting it later switches the extension off.
            Documents is a safer home for it than Downloads.
          </Callout>
        </>
      ),
    },
    {
      title: `Open the extensions page in ${browser.ready ? browser.name : "your browser"}`,
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            Copy this address, paste it into the address bar, and press Enter.
          </p>
          <div className="mt-2.5">
            <CopyChromeUrl url={browser.url || "chrome://extensions"} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Browsers block web pages from linking to their own internal pages, so
            copy-paste is the only way in.
          </p>
          <OtherBrowsers currentId={browser.ready ? browser.id : null} />
        </>
      ),
    },
    {
      title: "Turn on Developer mode",
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            Flip the <strong className="text-foreground">Developer mode</strong>{" "}
            switch in the top-right corner. This is what lets your browser load
            an extension from a folder instead of the Web Store.
          </p>
          <ExtensionsPageDiagram highlight="developer" />
        </>
      ),
    },
    {
      title: "Click Load unpacked and pick the folder",
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            Three buttons appear once Developer mode is on. Click{" "}
            <strong className="text-foreground">Load unpacked</strong> and select
            the <Code>{FOLDER_NAME}</Code> folder you extracted in step 2.
          </p>
          <ExtensionsPageDiagram highlight="load" />
          <Callout tone="warn" icon={AlertTriangle}>
            <p>
              Select the folder that has <Code>manifest.json</Code> directly
              inside it — not the folder above it.
            </p>
            <pre className="mt-2.5 overflow-x-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {`Downloads/
└── ${FOLDER_NAME}/     ← select this one
    ├── manifest.json
    ├── background/
    ├── content/
    └── icons/`}
            </pre>
            <p className="mt-2">
              If you see{" "}
              <em>&quot;Manifest file is missing or unreadable&quot;</em>,
              you&apos;ve picked the wrong level. Go one folder in, or one
              folder out.
            </p>
          </Callout>
        </>
      ),
    },
    {
      title: "Come back and check",
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">LeadsFunda Lead Scraper</strong>{" "}
            should now be listed. Switch back to this tab and press the button —
            it reloads the page, which a freshly installed extension needs
            before it can reach a tab that was already open.
          </p>
          <CheckAgainButton />
        </>
      ),
    },
  ];
}

// The old step six just asked people to reload. Telling somebody mid-install to
// go and press their own reload button is a step they can get wrong, or skip
// and then conclude the install failed — so it is a button here instead.
function CheckAgainButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-accent"
    >
      <RefreshCw className="h-4 w-4" />
      I&apos;ve installed it — check now
    </button>
  );
}

// Where to send somebody the moment the extension connects.
//
// Landing straight back on the search they abandoned is the whole point: they
// came here from a search that could not run, and "installed" is not the finish
// line they were after. `?from=search` is set by the landing page's own prompt;
// anyone else came from inside the app and wants the dashboard.
function useReturnTarget() {
  const [target, setTarget] = useState({
    href: "/dashboard",
    label: "Go to the dashboard",
  });

  useEffect(() => {
    try {
      const from = new URLSearchParams(window.location.search).get("from");
      if (from === "search" && MARKETING_URL) {
        setTarget({ href: MARKETING_URL, label: "Back to your search" });
      }
    } catch {
      // Keep the dashboard default.
    }
  }, []);

  return target;
}

function ReadyPanel({ version }) {
  const { href, label } = useReturnTarget();
  return (
    <div className="mt-8 rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-6">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <h2 className="font-medium text-foreground">
            Installed — you&apos;re ready to search
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Extension v{version} is connected. Live searches now run in this
            browser, so a search that covers new ground comes back straight from
            Google Maps instead of turning up empty.
          </p>
          <a
            href={href}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            {label}
            <ArrowRight className="h-4 w-4" />
          </a>
          <p className="mt-3 text-xs text-muted-foreground">
            One thing to remember: leave the extracted{" "}
            <Code>{FOLDER_NAME}</Code> folder where it is. Your browser re-reads
            it at every start, so moving or deleting it switches the extension
            back off.
          </p>
        </div>
      </div>
    </div>
  );
}

const FAQ = [
  {
    // Worded without "the amber badge above", because this list is also shown
    // once the extension is in — where there is no amber badge to point at.
    q: "It still says not installed, but I’ve installed it",
    a: (
      <>
        Reload this page first — the button in step 6 does it, and that alone
        fixes it most of the time. A newly loaded extension can only reach tabs
        opened after it. If it still says not installed, open the extensions
        page again and check the extension&apos;s own toggle is on, and that the
        address bar says <Code>leadsfunda.com</Code> — the extension is limited
        to that domain, so a preview or staging address won&apos;t connect.
      </>
    ),
  },
  {
    q: "A search still says I need the extension",
    a: (
      <>
        The tab running the search has to have been opened after the extension
        was loaded, same as this one. Reload that tab too — the search itself is
        unaffected, it just can&apos;t see the extension yet.
      </>
    ),
  },
  {
    q: "It says the manifest file is missing or unreadable",
    a: (
      <>
        That is always the wrong folder. You want the one containing{" "}
        <Code>manifest.json</Code> — see step 5. It also appears if you pointed
        the browser at the zip file itself instead of an extracted folder.
      </>
    ),
  },
  {
    q: "My browser warns that it isn’t from the Web Store",
    a: "Expected — this extension is distributed directly rather than through the store. Keep Developer mode switched on and dismiss the notice. Your browser may ask again after it updates.",
  },
  {
    q: "The extension disappeared after I restarted my browser",
    a: (
      <>
        The folder was moved, deleted, or was a temporary one inside the zip
        preview. Extract <Code>{ZIP_NAME}</Code> again somewhere permanent and
        repeat step 5.
      </>
    ),
  },
  {
    q: "How do I update it later?",
    a: (
      <>
        Download the zip again, extract it over the same folder, then click the
        circular refresh arrow on the extension&apos;s card on the extensions
        page. No need to remove and re-add it.
      </>
    ),
  },
  {
    q: "Why does it need access to every site?",
    a: "It reads Google Maps results, then visits each business's own website to find an email and social links — the same enrichment LeadsFunda has always done, just from your browser instead of our server.",
  },
  {
    q: "Do I have to keep the tab open?",
    a: "Keep the LeadsFunda tab open while a live search runs. It usually takes well under a minute.",
  },
];

function DesktopOnly() {
  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-6">
      <div className="flex gap-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="font-medium text-foreground">
            Browser extensions need a computer
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Phones and tablets can&apos;t install them. Open{" "}
            <Code>leadsfunda.com/extension</Code> on a Windows, Mac, or Linux
            machine and the steps will be waiting for you.
          </p>
          <p className="mt-2.5 text-sm text-muted-foreground">
            You can keep searching here in the meantime — anything already in our
            database comes back instantly. Only searches that need fresh data
            require the extension.
          </p>
        </div>
      </div>
    </div>
  );
}

function UnsupportedBrowser({ name, onOverride }) {
  return (
    <div className="mt-8 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] p-6">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <h2 className="font-medium text-foreground">
            {name} can&apos;t run this extension
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            It&apos;s built for Chrome-based browsers — Chrome, Edge, Brave,
            Opera, or Vivaldi. {name} uses a different extension format and
            won&apos;t load it.
          </p>
          <p className="mt-2.5 text-sm text-muted-foreground">
            Open <Code>leadsfunda.com/extension</Code> in one of those browsers
            and follow the steps there. Searches that don&apos;t need live data
            work fine in {name}.
          </p>
          <button
            type="button"
            onClick={onOverride}
            className="mt-3 text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            Show me the steps anyway
          </button>
        </div>
      </div>
    </div>
  );
}

function Troubleshooting() {
  return (
    <section className="mt-12 rounded-2xl border border-border bg-card/40 p-6">
      <h2 className="font-medium text-foreground">If something goes wrong</h2>
      <div className="mt-3 divide-y divide-border">
        {FAQ.map(({ q, a }) => (
          <details key={q} className="group py-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:content-none">
              <span className="mr-2 inline-block text-muted-foreground transition group-open:rotate-90">
                ›
              </span>
              {q}
            </summary>
            <div className="mt-2 pl-5 text-sm text-muted-foreground">{a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Steps({ browser }) {
  return (
    <ol className="mt-10 space-y-8">
      {steps(browser).map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-foreground">{step.title}</h2>
            <div className="mt-2">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function InstallGuide() {
  const { checking, installed, version } = useExtension({ poll: true });
  const browser = useBrowser();
  const [override, setOverride] = useState(false);

  const blocked =
    browser.ready && !override && (browser.mobile || !browser.supported);

  // Installed wins over every other state, including the mobile and unsupported
  // gates: if the extension is answering, the browser plainly runs it and no
  // amount of user-agent guessing should override that.
  //
  // Someone who has it working doesn't need a wall of instructions — but they
  // might be here to reinstall or update, so the steps stay one click away
  // rather than gone.
  if (installed) {
    return (
      <>
        <ReadyPanel version={version} />
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
            Show the install steps again
          </summary>
          <Steps browser={browser} />
        </details>
        <Troubleshooting />
      </>
    );
  }

  return (
    <>
      <ExtensionStatus checking={checking} installed={false} version={null} />

      {blocked ? (
        browser.mobile ? (
          <DesktopOnly />
        ) : (
          <UnsupportedBrowser name={browser.name} onOverride={() => setOverride(true)} />
        )
      ) : (
        <Steps browser={browser} />
      )}

      <Troubleshooting />
    </>
  );
}
