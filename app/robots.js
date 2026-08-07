const BASE = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The app surface is per-user and behind auth; keeping it out of the
        // index also stops crawlers piling up on redirects to /login.
        disallow: ["/api/", "/dashboard", "/leads", "/lists", "/watchlist", "/agent", "/billing", "/admin", "/login"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
