import seo from "../web/lib/seo.cjs";

const BASE = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

export default function robots() {
  // While the site is noindex, crawlers are still let in on purpose. Blocking
  // them here would stop them ever seeing the noindex, and anything already in
  // the index would stay there — see the note in web/lib/seo.cjs. The sitemap
  // is withheld because there is nothing we want submitted right now.
  if (seo.NOINDEX) {
    return {
      rules: [
        {
          userAgent: "*",
          allow: "/",
          disallow: ["/api/"],
        },
      ],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The app surface is per-user and behind auth; keeping it out of the
        // index also stops crawlers piling up on redirects to /login.
        disallow: ["/api/", "/dashboard", "/leads", "/lists", "/watchlist", "/agent", "/billing", "/admin", "/login", "/integrations", "/projects", "/domain-finder"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
