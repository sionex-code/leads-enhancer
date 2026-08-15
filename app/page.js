import Landing from "./components/Landing";
import { FAQ } from "./components/landing-data";
import pub from "../web/lib/public-searches.cjs";
import seo from "../web/lib/seo.cjs";

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

// `title.absolute` skips the "%s | LeadsFunda" template from the root layout -
// the home title already carries the brand and would otherwise say it twice.
export const metadata = {
  title: { absolute: "LeadsFunda: Google Maps Lead Generation with Email Enrichment" },
  description:
    "Scrape Google Maps for local business leads, enrich them with verified emails, WhatsApp numbers and socials, audit their websites, then push straight into Smartlead, Instantly, HubSpot or Pipedrive.",
  alternates: { canonical: MARKETING_URL },
};

// Public marketing landing, served to everyone - signed in or not.
//
// It used to bounce a signed-in visitor to /dashboard. That was wrong twice
// over: on the marketing host the session cookie is invisible anyway (see
// app/api/public/me/route.js) so the check never fired where it mattered, and
// where it did fire it made the landing page unreachable for the very people
// most likely to link someone to it. Signed-in state now changes the buttons,
// not the destination - Landing asks /api/public/me and swaps its sign-in CTAs
// for "Open dashboard".
export const dynamic = "force-dynamic";

export default async function Page() {
  const checkout = {
    p19: process.env.WHOP_CHECKOUT_19 || "",
    p35: process.env.WHOP_CHECKOUT_35 || "",
    p49: process.env.WHOP_CHECKOUT_49 || "",
  };
  // Public directory teasers. Never let this break the landing page - it is
  // the marketing front door and a directory outage must not take it down.
  const [recent, total] = await Promise.all([
    pub.recent(12).catch(() => []),
    pub.count().catch(() => 0),
  ]);
  return (
    <>
      {/* Structured data, skipped entirely while the site is noindex - offering
          rich results for pages we are asking Google to drop is the same mixed
          signal web/lib/seo.cjs exists to avoid.

          The FAQ answers come from the same array the visible accordion renders,
          because Google treats FAQPage markup that isn't on the page as a
          violation. */}
      {!seo.NOINDEX ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(total)) }}
        />
      ) : null}
      <Landing checkout={checkout} recent={recent} total={total} />
    </>
  );
}

function structuredData(total) {
  const org = {
    "@type": "Organization",
    "@id": `${MARKETING_URL}/#organization`,
    name: "LeadsFunda",
    url: MARKETING_URL,
    logo: `${MARKETING_URL}/brand/leadsfunda-icon.svg`,
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      org,
      {
        "@type": "WebSite",
        "@id": `${MARKETING_URL}/#website`,
        url: MARKETING_URL,
        name: "LeadsFunda",
        publisher: { "@id": org["@id"] },
      },
      {
        "@type": "SoftwareApplication",
        name: "LeadsFunda",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: MARKETING_URL,
        publisher: { "@id": org["@id"] },
        description:
          "Find local business leads from public map listings, enrich them with emails, WhatsApp numbers and social profiles, audit their websites, and push them into Smartlead, Instantly, HubSpot or Pipedrive.",
        featureList: [
          "Google Maps lead scraping",
          "Email and social enrichment",
          "WhatsApp number detection",
          "Website health audits",
          "CRM and cold-email integrations",
          "CSV export",
        ],
        // Only the plans that are actually purchasable. The free tier is listed
        // first so the price range starts at 0, which is true.
        offers: [
          { "@type": "Offer", name: "Starter", price: "0", priceCurrency: "USD" },
          { "@type": "Offer", name: "Starter", price: "19", priceCurrency: "USD" },
          { "@type": "Offer", name: "Growth", price: "35", priceCurrency: "USD" },
          { "@type": "Offer", name: "Scale", price: "49", priceCurrency: "USD" },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      // The public directory is the site's real long-tail surface; naming it
      // here gives crawlers a second route into it from the home page.
      ...(total
        ? [{
            "@type": "CollectionPage",
            "@id": `${MARKETING_URL}/directory#collection`,
            url: `${MARKETING_URL}/directory`,
            name: "Lead Directory: business lists by city and service",
            isPartOf: { "@id": `${MARKETING_URL}/#website` },
          }]
        : []),
    ],
  };
}
