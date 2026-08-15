import "./tailwind.css";
import { Instrument_Sans } from "next/font/google";
import Providers from "./providers";
import seo from "../web/lib/seo.cjs";

// Display face for marketing headings (echoes the landing template). Body text
// keeps the existing Inter stack from tailwind.css; this only adds a heading font.
const display = Instrument_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

export const metadata = {
  // Without metadataBase every relative OG/Twitter image URL resolves against
  // localhost at build time, so shared links preview blank in production.
  metadataBase: new URL(MARKETING_URL),
  title: {
    default: "LeadsFunda: Google Maps lead generation with email enrichment",
    // Sub-pages set a bare title and get the brand appended once, rather than
    // each hand-writing "| LeadsFunda".
    template: "%s | LeadsFunda",
  },
  description:
    "Scrape Google Maps for local business leads, enrich them with verified emails, WhatsApp numbers and socials, audit their websites, then push straight into Smartlead, Instantly, HubSpot or Pipedrive.",
  applicationName: "LeadsFunda",
  keywords: [
    "google maps scraper", "lead generation software", "b2b lead generation",
    "local business leads", "email finder", "cold email leads",
    "smartlead integration", "instantly integration", "hubspot integration",
    "lead enrichment", "website audit tool",
  ],
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "LeadsFunda" },
  openGraph: {
    type: "website",
    siteName: "LeadsFunda",
    url: MARKETING_URL,
    title: "LeadsFunda: Google Maps lead generation with email enrichment",
    description:
      "Find local businesses, enrich them with emails and WhatsApp, audit their sites, and send them straight to Smartlead, Instantly, HubSpot or Pipedrive.",
  },
  twitter: {
    card: "summary_large_image",
    title: "LeadsFunda: Google Maps lead generation with email enrichment",
    description:
      "Find local businesses, enrich them with emails and WhatsApp, and push them into your CRM or cold-email tool.",
  },
  // undefined when SEO_NOINDEX is off, which leaves Next to emit nothing and
  // the default (indexable) to apply.
  robots: seo.ROBOTS_META,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0f1d",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={display.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
