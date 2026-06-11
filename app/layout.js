import "./globals.css";

export const metadata = {
  title: "Lead Ops",
  description: "Google Maps lead scraping, enrichment, and Lighthouse audits",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Lead Ops" },
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
      <body>{children}</body>
    </html>
  );
}
