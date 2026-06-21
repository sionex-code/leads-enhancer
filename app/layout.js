import "./tailwind.css";
import { Instrument_Sans } from "next/font/google";
import Providers from "./providers";

// Display face for marketing headings (echoes the landing template). Body text
// keeps the existing Inter stack from tailwind.css; this only adds a heading font.
const display = Instrument_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata = {
  title: "LeadsFunda: Google Maps lead generation",
  description: "Scrape Google Maps business leads, enrich emails & socials, and audit their websites, at scale.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "LeadsFunda" },
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
