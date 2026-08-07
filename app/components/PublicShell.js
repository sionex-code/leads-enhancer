import Image from "next/image";

// Chrome for the public directory pages. These live on the marketing host and
// are meant to be indexed, so they are server-rendered with no client JS — a
// signed-out visitor and a crawler see exactly the same HTML.
export default function PublicShell({ children }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "/login";

  return (
    <div className="lf relative min-h-screen bg-background text-foreground">
      <header className="sticky top-3 z-40 px-4">
        <div className="container">
          <div className="flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 pl-5 shadow-sm backdrop-blur-xl">
            <a href="/" className="flex items-center" aria-label="LeadsFunda home">
              <Image
                src="/brand/leadsfunda-white.svg"
                alt="LeadsFunda"
                width={145}
                height={28}
                priority
                className="h-[20px] w-auto sm:h-[28px]"
              />
            </a>
            <nav className="flex items-center gap-2 text-sm font-medium">
              <a
                href="/directory"
                className="hidden rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
              >
                Directory
              </a>
              <a
                href={appUrl}
                className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
              >
                Get started
              </a>
            </nav>
          </div>
        </div>
      </header>

      <main className="container px-4 pb-24 pt-10">{children}</main>

      <footer className="border-t border-border/60 py-8">
        <div className="container flex flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} LeadsFunda. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <a href="/directory" className="transition-colors hover:text-foreground">Directory</a>
            <a href="/privacy" className="transition-colors hover:text-foreground">Privacy</a>
            <a href="/terms" className="transition-colors hover:text-foreground">Terms</a>
            <a href="/contact" className="transition-colors hover:text-foreground">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
