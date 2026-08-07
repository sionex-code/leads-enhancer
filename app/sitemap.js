import pub from "../web/lib/public-searches.cjs";

export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_MARKETING_URL || "https://leadsfunda.com";

// Google caps a single sitemap at 50k URLs; stay well under and let the
// directory index carry the long tail via internal links.
const MAX_ENTRIES = 20000;

export default async function sitemap() {
  const staticPages = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/directory`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/contact`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/can-spam`, changeFrequency: "yearly", priority: 0.2 },
  ].map((p) => ({ ...p, lastModified: new Date() }));

  const entries = await pub.all(MAX_ENTRIES).catch(() => []);
  return [
    ...staticPages,
    ...entries.map((e) => ({
      url: `${BASE}/directory/${e.slug}`,
      lastModified: e.lastSeen ? new Date(e.lastSeen) : new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    })),
  ];
}
