import { MapPin, ArrowRight, Building2 } from "lucide-react";
import PublicShell from "../components/PublicShell";
import pub from "../../web/lib/public-searches.cjs";

export const dynamic = "force-dynamic";

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

export const metadata = {
  title: "Lead Directory: Business Lists by City and Service | LeadsFunda",
  description:
    "Browse ready-made B2B lead lists by city and service. Plumbers, dentists, restaurants and more, with ratings, review counts and contact details.",
  alternates: { canonical: `${MARKETING_URL}/directory` },
};

// ISO-3166 alpha-2 to flag emoji. Same trick as the landing page cards.
function flagOf(code) {
  const cc = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export default async function DirectoryIndex() {
  const entries = await pub.all(20000);

  // Group by country so a long list stays navigable.
  const byCountry = new Map();
  for (const e of entries) {
    const key = e.countryName || e.countryCode || "Other";
    if (!byCountry.has(key)) byCountry.set(key, { code: e.countryCode, items: [] });
    byCountry.get(key).items.push(e);
  }
  const countries = [...byCountry.entries()].sort((a, b) => b[1].items.length - a[1].items.length);
  const totalBusinesses = entries.reduce((a, e) => a + (e.leadCount || 0), 0);

  return (
    <PublicShell>
      {/* An index of 5,000 pages needs to be crawlable as a structure, not just
          a wall of links, so the breadcrumb and collection type are declared. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "LeadsFunda Lead Directory",
            description: "Business lead lists by city and service.",
            url: `${MARKETING_URL}/directory`,
            isPartOf: { "@type": "WebSite", name: "LeadsFunda", url: MARKETING_URL },
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: MARKETING_URL },
                { "@type": "ListItem", position: 2, name: "Directory", item: `${MARKETING_URL}/directory` },
              ],
            },
          }),
        }}
      />

      <nav className="mb-6 text-sm text-muted-foreground">
        <a href="/" className="transition-colors hover:text-foreground">Home</a>
        <span className="px-2">/</span>
        <span className="text-foreground">Directory</span>
      </nav>

      <header className="mb-10">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
          Lead directory
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Business lists by city and service, built from public Google Maps listings.
          Every list shows ratings, review counts and areas. Sign in to see full contact
          details and export to CSV.
        </p>
        {entries.length > 0 && (
          <dl className="mt-6 flex flex-wrap gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Lists</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {entries.length.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Businesses</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {totalBusinesses.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Countries</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {countries.length}
              </dd>
            </div>
          </dl>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No public lists yet. They appear here as searches are run.
        </div>
      ) : (
        <>
          {/* Jump links: with thousands of entries the country headings are far
              enough apart that a reader cannot see them all at once. */}
          <nav className="mb-10 flex flex-wrap gap-2">
            {countries.map(([country, { code, items }]) => (
              <a
                key={country}
                href={`#${encodeURIComponent(country)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                {flagOf(code) && <span aria-hidden="true">{flagOf(code)}</span>}
                {country}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                  {items.length}
                </span>
              </a>
            ))}
          </nav>

          {countries.map(([country, { code, items }]) => (
            <section key={country} id={country} className="mb-12 scroll-mt-24">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                {flagOf(code) ? (
                  <span aria-hidden="true" className="text-xl leading-none">{flagOf(code)}</span>
                ) : (
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                )}
                {country}
                <span className="text-sm font-normal text-muted-foreground">
                  ({items.length.toLocaleString()} lists)
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((e) => (
                  <a
                    key={e.slug}
                    href={`/directory/${e.slug}`}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition hover:border-primary/50 hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {e.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {e.leadCount.toLocaleString()} businesses
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </a>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </PublicShell>
  );
}
