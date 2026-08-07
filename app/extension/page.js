import AppShell from "../components/app/AppShell";
import ExtensionStatus from "./ExtensionStatus";
import CopyChromeUrl from "./CopyChromeUrl";

export const metadata = {
  title: "Install the LeadsFunda extension",
  description:
    "Install the LeadsFunda Chrome extension to run live Google Maps lead searches in your own browser.",
};

const STEPS = [
  {
    title: "Download the extension",
    body: (
      <>
        <a
          href="/leadsfunda-extension.zip"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Download leadsfunda-extension.zip
        </a>
        <p className="mt-2 text-sm text-muted-foreground">
          Then unzip it somewhere permanent — Documents or Desktop is fine.
          Chrome loads it from that folder every time it starts, so don&apos;t
          delete it afterwards.
        </p>
      </>
    ),
  },
  {
    title: "Open Chrome's extensions page",
    body: (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Click to copy the address, then paste it into your address bar and
          press Enter. (Browsers block pages from linking directly to internal
          pages like this one, so copy-paste is the fastest way in.)
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
          <CopyChromeUrl url="chrome://extensions" />
          <span className="text-xs text-muted-foreground">or</span>
          <CopyChromeUrl url="edge://extensions" />
          <span className="text-xs text-muted-foreground">or</span>
          <CopyChromeUrl url="brave://extensions" />
        </div>
      </div>
    ),
  },
  {
    title: "Turn on Developer mode",
    body: (
      <p className="text-sm text-muted-foreground">
        Flip the <strong className="text-foreground">Developer mode</strong> switch in
        the top-right corner. This is what lets Chrome load an extension from a
        folder instead of the Web Store.
      </p>
    ),
  },
  {
    title: "Load the unzipped folder",
    body: (
      <p className="text-sm text-muted-foreground">
        Click <strong className="text-foreground">Load unpacked</strong> and pick the
        folder you unzipped. You should see{" "}
        <strong className="text-foreground">LeadsFunda Lead Scraper</strong> appear in
        the list.
      </p>
    ),
  },
  {
    title: "Reload LeadsFunda",
    body: (
      <p className="text-sm text-muted-foreground">
        Come back here and refresh the page. The badge above turns green once the
        extension connects, and live searches will start working.
      </p>
    ),
  },
];

const FAQ = [
  {
    q: "Chrome says the extension isn't from the Web Store.",
    a: "That's expected for a directly-distributed extension. Keep Developer mode on; Chrome may ask you to confirm again after an update.",
  },
  {
    q: "Why does it need site access?",
    a: "It reads Google Maps results, and visits each business's own website to find an email and social links — the same enrichment LeadsFunda has always done, just from your browser instead of our server.",
  },
  {
    q: "Do I have to keep the tab open?",
    a: "Keep the LeadsFunda tab open while a live search runs. It usually takes well under a minute.",
  },
];

export default function ExtensionPage() {
  return (
    <AppShell
      active="extension"
      title="Browser extension"
      subtitle="Run live searches in your own browser"
    >
      <div className="mx-auto max-w-3xl">
        <p className="max-w-2xl text-muted-foreground">
          Most searches are served instantly from leads we already have. When a
          search covers ground we haven&apos;t collected yet, the extension pulls it
          straight from Google Maps on your machine — no queue, and no waiting
          behind anyone else&apos;s search.
        </p>

        <ExtensionStatus />

        <ol className="mt-10 space-y-8">
          {STEPS.map((step, i) => (
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

        <section className="mt-12 rounded-2xl border border-border bg-card/40 p-6">
          <h2 className="font-medium text-foreground">Common questions</h2>
          <dl className="mt-4 space-y-4 text-sm">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <dt className="font-medium text-foreground">{q}</dt>
                <dd className="mt-1 text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </AppShell>
  );
}
