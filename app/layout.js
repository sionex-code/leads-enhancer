import "./tailwind.css";
import Providers from "./providers";

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
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
