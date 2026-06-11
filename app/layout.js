import "./globals.css";

export const metadata = {
  title: "Lead Ops",
  description: "Google Maps lead scraping, enrichment, and Lighthouse audits",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
