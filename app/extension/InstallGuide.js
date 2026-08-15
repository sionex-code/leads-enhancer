"use client";

import { useEffect, useState } from "react";
import {
  Download,
  Info,
  Smartphone,
  AlertTriangle,
  ArrowRight,
  ArrowUpCircle,
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
// instruction, and it is also where installs most often go wrong, so it keeps
// its own wording per OS rather than a vague "unzip it".
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

// Four steps, not six. Downloading and unzipping are one errand in the user's
// head, and so are "open the extensions page" and "flip the switch on it", so
// pairing them cuts the apparent length of the install without dropping a single
// instruction. Picking the folder keeps its own step because it is where installs
// actually fail.
function steps(browser) {
  return [
    {
      title: "Download and unzip",
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
            About 100&nbsp;KB. It lands in your Downloads folder.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {browser.ready ? UNZIP[browser.os] || UNZIP.other : UNZIP.other}
          </p>
          <Callout tone="warn" icon={AlertTriangle}>
            Unzip it properly, don&apos;t just look inside the zip. Then keep the
            folder somewhere permanent, like Documents. Your browser re-reads it
            at every start, so deleting it turns the extension off.
          </Callout>
        </>
      ),
    },
    {
      title: "Open the extensions page and turn on Developer mode",
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            Paste this into the address bar and press Enter. Browsers block links
            to their own internal pages, so pasting is the only way in.
          </p>
          <div className="mt-2.5">
            <CopyChromeUrl url={browser.url || "chrome://extensions"} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Turn on <strong className="text-foreground">Developer mode</strong>,
            top right of that page.
          </p>
          <ExtensionsPageDiagram highlight="developer" />
          <OtherBrowsers currentId={browser.ready ? browser.id : null} />
        </>
      ),
    },
    {
      title: "Click Load unpacked and pick the folder",
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            Click <strong className="text-foreground">Load unpacked</strong>, then
            select the <Code>{FOLDER_NAME}</Code> folder you just unzipped.
          </p>
          <ExtensionsPageDiagram highlight="load" />
          <Callout tone="warn" icon={AlertTriangle}>
            <p>
              Pick the folder with <Code>manifest.json</Code> directly inside it.
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
              <em>&quot;Manifest file is missing or unreadable&quot;</em> means
              you picked the wrong level. Go one folder in or out.
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
            should now be in the list. Come back here and press the button. It
            reloads this page, which a new extension needs before it can see it.
          </p>
          <CheckAgainButton />
        </>
      ),
    },
  ];
}

// The last step used to just ask people to reload. Telling somebody mid-install
// to go and press their own reload button is a step they can get wrong, or skip
// and then conclude the install failed, so it is a button here instead.
function CheckAgainButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-accent"
    >
      <RefreshCw className="h-4 w-4" />
      I&apos;ve installed it, check now
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

function ReadyPanel({ version, outdated, latestVersion }) {
  const { href, label } = useReturnTarget();
  const browser = useBrowser();

  // An outdated install is the whole reason somebody lands back here, so it
  // gets the download button up front rather than a green "you're all set".
  if (outdated) {
    return (
      <div className="mt-8 rounded-2xl border border-sky-500/40 bg-sky-500/[0.08] p-6">
        <div className="flex gap-3">
          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
          <div className="min-w-0">
            <h2 className="font-medium text-foreground">
              An update is ready{latestVersion ? ` - v${latestVersion}` : ""}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You&apos;re running v{version}. Download the zip, unzip it over the
              same <Code>{FOLDER_NAME}</Code> folder, then click the refresh arrow
              on its card at <Code>{browser.url || "chrome://extensions"}</Code>.
              Reload this page afterwards so it can see the new version.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href={`/${ZIP_NAME}`}
                download
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
              >
                <Download className="h-4 w-4" />
                Download the update
              </a>
              <a
                href={href}
                className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
              >
                Skip for now
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-6">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <h2 className="font-medium text-foreground">
            Installed, you&apos;re ready to search
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Extension v{version} is connected. Live searches now run in this
            browser, so a search that covers new ground comes back straight from
            the map instead of turning up empty.
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
    // once the extension is in - where there is no amber badge to point at.
    q: "It still says not installed, but I’ve installed it",
    a: (
      <>
        Reload this page, which the button in step 4 does. That fixes it most of
        the time. If not, check the extension&apos;s own toggle is on and that
        the address bar says <Code>leadsfunda.com</Code>, the only domain it
        works on.
      </>
    ),
  },
  {
    q: "A search still says I need the extension",
    a: "Reload that tab too. A new extension can only see tabs opened after it.",
  },
  {
    q: "It says the manifest file is missing or unreadable",
    a: (
      <>
        Wrong folder. Pick the one containing <Code>manifest.json</Code>, see
        step 3. You get the same message if you point at the zip itself.
      </>
    ),
  },
  {
    q: "My browser warns that it isn’t from the Web Store",
    a: "Expected. We hand out the extension directly. Leave Developer mode on and dismiss the notice.",
  },
  {
    q: "The extension disappeared after I restarted my browser",
    a: (
      <>
        Its folder was moved or deleted. Unzip <Code>{ZIP_NAME}</Code> again
        somewhere permanent and repeat step 3.
      </>
    ),
  },
  {
    q: "How do I update it later?",
    a: "Download the zip again, unzip it over the same folder, then click the refresh arrow on its card. No need to remove and re-add it.",
  },
  {
    q: "Why does it need access to every site?",
    a: "It reads map results, then visits each business's website for an email and social links. Same enrichment as always, just from your browser.",
  },
  {
    q: "Do I have to keep the tab open?",
    a: "Yes, while a live search runs. It usually takes under a minute.",
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
            You can keep searching here in the meantime, because anything already
            in our database comes back instantly. Only searches that need fresh
            data require the extension.
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
            It&apos;s built for Chrome-based browsers: Chrome, Edge, Brave,
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
  const { checking, installed, version, outdated, latestVersion } = useExtension({ poll: true });
  const browser = useBrowser();
  const [override, setOverride] = useState(false);

  const blocked =
    browser.ready && !override && (browser.mobile || !browser.supported);

  // Installed wins over every other state, including the mobile and unsupported
  // gates: if the extension is answering, the browser plainly runs it and no
  // amount of user-agent guessing should override that.
  //
  // Someone who has it working doesn't need a wall of instructions, but they
  // might be here to reinstall or update, so the steps stay one click away
  // rather than gone.
  if (installed) {
    return (
      <>
        <ReadyPanel version={version} outdated={outdated} latestVersion={latestVersion} />
        <details className="mt-8" open={outdated}>
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
