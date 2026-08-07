import { notFound } from "next/navigation";
import { Lock, Star, Search, Globe2, Phone, MapPin, ArrowRight } from "lucide-react";
import PublicShell from "../../components/PublicShell";
import pub from "../../../web/lib/public-searches.cjs";
import warehouse from "../../../web/lib/warehouse.cjs";
import db from "../../../web/lib/db.cjs";
import { headers } from "next/headers";
import { auth } from "../../../auth";
import billing from "../../../web/lib/billing.cjs";

export const dynamic = "force-dynamic";

// How many businesses a visitor may see.
const PUBLIC_ROWS = 30;

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

const titleCase = (s) =>
  String(s || "").trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Everything a public visitor is allowed to receive. Called on the server; the
// unmasked email/phone/website are never serialised into the response, so what
// is withheld is genuinely absent from the page rather than hidden with CSS.
// tier: "public" (signed out) | "member" (signed in, no plan) | "full"
function toPublicRow(wh, cityName, email, tier) {
  const reviews = wh.reviews != null && wh.reviews !== "" ? Number(wh.reviews) : null;
  return {
    name: wh.name || "",
    category: wh.category || "",
    rating: wh.rating != null && wh.rating !== "" ? String(wh.rating) : "",
    reviews: Number.isFinite(reviews) ? reviews : null,
    // Name and address stay fully visible: they are the useful, indexable part
    // of the listing and are already public on Google Maps. What is held back
    // is the contact channel, not the identity of the business.
    address: String(wh.address || "").slice(0, 90) || cityName || "",
    email: tier === "full" ? (email || "") : pub.maskEmailAtDomain(email, wh.website),
    phone: tier === "full" ? (wh.phone || "") : pub.maskPhone(wh.phone),
    website: tier === "public" ? pub.maskWebsite(wh.website) : pub.hostOf(wh.website),
  };
}

const hostOf = (u) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `http://${u}`).hostname
      .replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
};

async function loadPage(slug, tier) {
  const entry = await pub.bySlug(slug);
  if (!entry) return null;

  let rows = [];
  try {
    const res = await warehouse.queryLeads({
      cityId: entry.cityId ?? undefined,
      countryCode: entry.cityId ? undefined : entry.countryCode || undefined,
      service: entry.service,
      limit: PUBLIC_ROWS,
    });
    const raw = res.rows || [];

    // The warehouse stores no emails at all; enrichment lands in the shared,
    // cross-tenant domain cache. Look this page's domains up there in one query
    // rather than showing an Email column that is always blank.
    let enrichment = new Map();
    try {
      enrichment = await db.getCachedEnrichmentMap(raw.map((r) => r.website || ""));
    } catch {
      enrichment = new Map();
    }

    rows = raw.map((r) =>
      toPublicRow(r, entry.cityName, enrichment.get(hostOf(r.website || ""))?.email || "", tier)
    );
  } catch {
    rows = []; // the page is still worth rendering with its CTA
  }

  // Real aggregates for this list. These are what stop 5,000 near-identical
  // pages reading as one template with the city name swapped: every number
  // below is computed from this page's own rows.
  const rated = rows.filter((r) => Number(r.rating) > 0);
  const reviewed = rows.filter((r) => r.reviews != null);
  const categoryCounts = new Map();
  for (const r of rows) {
    const c = titleCase(r.category);
    if (c) categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1);
  }
  const topCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const stats = {
    shown: rows.length,
    avgRating: rated.length
      ? (rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length).toFixed(1)
      : null,
    totalReviews: reviewed.reduce((a, r) => a + (r.reviews || 0), 0),
    topRated: rated.filter((r) => Number(r.rating) >= 4.5).length,
    withPhone: rows.filter((r) => r.phone).length,
    withSite: rows.filter((r) => r.website).length,
    topCategories,
  };

  const links = await pub.related(entry, 8);
  return { entry, rows, stats, links };
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const { onAppHost } = await resolveTier();
  const entry = await pub.bySlug(slug);
  if (!entry) return { title: "Not found | LeadsFunda" };

  const where = [entry.cityName, entry.countryName].filter(Boolean).join(", ");
  const count = entry.leadCount.toLocaleString();
  return {
    title: `${entry.title}: ${count} Businesses | LeadsFunda`,
    description:
      `${count} ${entry.service} businesses in ${where} with ratings, review counts, ` +
      `websites and contact details. Browse the list or export it with LeadsFunda.`,
    alternates: { canonical: `${MARKETING_URL}/directory/${entry.slug}` },
    // Below the publish threshold a page is real but too thin to deserve
    // indexing. Serving it while keeping it out of the index is the difference
    // between a directory and a doorway farm.
    robots:
      onAppHost || entry.leadCount < pub.MIN_PUBLIC_LEADS
        ? { index: false, follow: true }
        : { index: true, follow: true },
    openGraph: {
      title: `${entry.title}: ${count} businesses`,
      description: `${entry.service} businesses in ${where}, with ratings and contact details.`,
      url: `${MARKETING_URL}/directory/${entry.slug}`,
      type: "website",
    },
  };
}

// Which host is serving this. The session cookie is scoped to the app host, so
// on the marketing host there is never a session to read and every visitor is
// "public". That is the version crawlers index.
async function resolveTier() {
  try {
    const h = await headers();
    const host = (h.get("host") || "").toLowerCase();
    const appHost = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/^https?:\/\//, "").toLowerCase();
    if (!appHost || host !== appHost) return { tier: "public", onAppHost: false };

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return { tier: "public", onAppHost: true };
    const ent = await billing.getEntitlement(userId);
    return { tier: ent?.active || ent?.unlimited ? "full" : "member", onAppHost: true };
  } catch {
    return { tier: "public", onAppHost: false };
  }
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</dd>
      {hint && <dd className="mt-0.5 text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export default async function DirectoryEntry({ params }) {
  const { slug } = await params;
  const { tier } = await resolveTier();
  const data = await loadPage(slug, tier);
  if (!data) notFound();

  const { entry, rows, stats, links } = data;
  const where = [entry.cityName, entry.countryName].filter(Boolean).join(", ");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "/login";
  const service = titleCase(entry.service);
  const pctPhone = stats.shown ? Math.round((stats.withPhone / stats.shown) * 100) : 0;
  const pctSite = stats.shown ? Math.round((stats.withSite / stats.shown) * 100) : 0;

  // Questions answered with this page's own numbers. Generic boilerplate here
  // would be the thing that makes a large directory look automated; these
  // change per city because the underlying rows do.
  const faqs = [
    {
      q: `How many ${entry.service} businesses are listed in ${entry.cityName}?`,
      a: `${entry.leadCount.toLocaleString()} ${entry.service} businesses in ${where} are in this list. ` +
         `${stats.shown} of them are shown on this page.`,
    },
    {
      q: `Do these ${entry.service} listings include phone numbers and websites?`,
      a: `${pctPhone}% of the businesses shown here have a phone number on file and ${pctSite}% have a website. ` +
         `Contact details are shortened on this page and shown in full inside LeadsFunda.`,
    },
    {
      q: `How well rated are ${entry.service} businesses in ${entry.cityName}?`,
      a: stats.avgRating
        ? `They average ${stats.avgRating} out of 5 across ${stats.totalReviews.toLocaleString()} reviews, ` +
          `and ${stats.topRated} of the ${stats.shown} shown are rated 4.5 or higher.`
        : `Ratings are not yet available for this list.`,
    },
    {
      q: `Where does this ${entry.cityName} data come from?`,
      a: `Every listing is built from public Google Maps business profiles and refreshed as new searches run. ` +
         `Nothing here is scraped from private sources.`,
    },
  ];

  return (
    <PublicShell>
      {/* Page-level structured data only. The rows carry shortened contact
          values, so publishing them as itemListElement would assert facts the
          page is deliberately not stating. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: entry.title,
              description: `${entry.service} businesses in ${where}.`,
              url: `${MARKETING_URL}/directory/${entry.slug}`,
              isPartOf: { "@type": "WebSite", name: "LeadsFunda", url: MARKETING_URL },
              about: { "@type": "Place", name: where },
              breadcrumb: {
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Home", item: MARKETING_URL },
                  { "@type": "ListItem", position: 2, name: "Directory", item: `${MARKETING_URL}/directory` },
                  { "@type": "ListItem", position: 3, name: entry.title },
                ],
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: faqs.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]),
        }}
      />

      <nav className="mb-6 text-sm text-muted-foreground">
        <a href="/" className="transition-colors hover:text-foreground">Home</a>
        <span className="px-2">/</span>
        <a href="/directory" className="transition-colors hover:text-foreground">Directory</a>
        <span className="px-2">/</span>
        <span className="text-foreground">{entry.title}</span>
      </nav>

      <header className="mb-8 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 p-6 sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {where}
        </span>
        <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight sm:text-5xl">
          {entry.title}
        </h1>
        {/* Built from this page's own aggregates, so no two cities read alike. */}
        <p className="mt-4 max-w-2xl text-muted-foreground">
          {entry.leadCount.toLocaleString()} {entry.service} businesses across {where}
          {stats.avgRating
            ? `, averaging ${stats.avgRating} out of 5 from ${stats.totalReviews.toLocaleString()} customer reviews`
            : ""}
          . {stats.shown} are listed below with their ratings, categories and areas.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={appUrl}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Search className="h-4 w-4" />
            Open all {entry.leadCount.toLocaleString()} in LeadsFunda
          </a>
          <span className="text-xs text-muted-foreground">
            CSV export · updated as new searches run
          </span>
        </div>
      </header>

      {stats.shown > 0 && (
        <dl className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Businesses" value={entry.leadCount.toLocaleString()} hint={`in ${entry.cityName}`} />
          <StatCard
            label="Average rating"
            value={stats.avgRating ? `${stats.avgRating} / 5` : "n/a"}
            hint={stats.avgRating ? `${stats.topRated} rated 4.5 or higher` : "not enough ratings"}
          />
          <StatCard label="Reviews counted" value={stats.totalReviews.toLocaleString()} hint="across this page" />
          <StatCard label="Reachable" value={`${pctPhone}%`} hint={`have a phone · ${pctSite}% have a site`} />
        </dl>
      )}

      {stats.topCategories.length > 1 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            What kind of {entry.service} businesses are in {entry.cityName}
          </h2>
          <div className="flex flex-wrap gap-2">
            {stats.topCategories.map(([name, n]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
              >
                {name}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                  {n}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          This listing is being refreshed. Try the{" "}
          <a href="/directory" className="text-foreground underline">directory index</a>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">
                    <Globe2 className="mr-1 inline h-3 w-3" />Website
                  </th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">
                    <Phone className="mr-1 inline h-3 w-3" />Phone
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground/70">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.name}</div>
                      {r.category && (
                        <div className="text-xs text-muted-foreground">{r.category}</div>
                      )}
                      {r.address && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground/70">{r.address}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.rating ? (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span className="font-medium">{r.rating}</span>
                          {r.reviews != null && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              ({r.reviews.toLocaleString()})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.website || "n/a"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.email ? (
                        r.email
                      ) : tier === "full" ? (
                        // Nothing is being withheld from a viewer with a plan:
                        // we simply hold no address for this business. Implying
                        // otherwise would promise data that does not exist.
                        <span className="font-sans text-muted-foreground">n/a</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-sans text-[11px] text-muted-foreground">
                          <Lock className="h-3 w-3" />
                          hidden
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {r.phone || "n/a"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Nothing is smudged: the withheld fields are simply not in the
              response. This states plainly what is missing and what reveals it. */}
          <div className="border-t border-border bg-muted/30 px-4 py-7 text-center">
            {tier === "full" ? (
              <p className="text-sm text-muted-foreground">
                Showing {rows.length} of {entry.leadCount.toLocaleString()} businesses with full
                contact details.{" "}
                <a href={`${appUrl}/dashboard`} className="font-semibold text-primary hover:underline">
                  Open the full list in your workspace
                </a>
              </p>
            ) : tier === "member" ? (
              <>
                <p className="text-sm font-semibold text-foreground">
                  Unlock the emails and phone numbers
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  You are signed in, so websites are shown in full. Upgrade your plan to
                  reveal every email and phone number and export all{" "}
                  {entry.leadCount.toLocaleString()} businesses.
                </p>
                <a
                  href={`${appUrl}/billing`}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
                >
                  <Lock className="h-4 w-4" />
                  Unlock full leads
                </a>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground">
                  Sign in to view full leads
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Websites, emails and phone numbers are shortened on public pages.
                  Sign in to see them and to export the whole list.
                </p>
                <a
                  href={`${appUrl}/login?callbackUrl=${encodeURIComponent(`/directory/${entry.slug}`)}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
                >
                  Sign in to view full leads
                  <ArrowRight className="h-4 w-4" />
                </a>
              </>
            )}
          </div>
        </div>
      )}

      <section className="mt-12">
        <h2 className="mb-4 font-heading text-2xl font-bold tracking-tight">
          {service} leads in {entry.cityName}: common questions
        </h2>
        <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card">
          {faqs.map((f) => (
            <div key={f.q} className="px-5 py-4">
              <h3 className="text-sm font-semibold text-foreground">{f.q}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {(links.sameCity.length > 0 || links.sameService.length > 0) && (
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {links.sameCity.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold text-foreground">
                More lists in {entry.cityName}
              </h2>
              <ul className="space-y-1.5">
                {links.sameCity.map((l) => (
                  <li key={l.slug}>
                    <a href={`/directory/${l.slug}`} className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
                      {l.title} <span className="text-xs">({l.leadCount.toLocaleString()})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {links.sameService.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold text-foreground">
                {service} lists in other cities
              </h2>
              <ul className="space-y-1.5">
                {links.sameService.map((l) => (
                  <li key={l.slug}>
                    <a href={`/directory/${l.slug}`} className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
                      {l.title} <span className="text-xs">({l.leadCount.toLocaleString()})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <p className="mt-10 text-xs text-muted-foreground">
        Contact details on this page are shortened. Business information is collected
        from public Google Maps listings. To have a listing removed,{" "}
        <a href="/contact" className="underline transition-colors hover:text-foreground">
          contact us
        </a>.
      </p>
    </PublicShell>
  );
}
