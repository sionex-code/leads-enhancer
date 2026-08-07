// Is the site currently asking search engines to stay out?
//
// One switch, read by everything that can speak to a crawler: the X-Robots-Tag
// header in next.config.js, the root metadata in app/layout.js, the per-page
// override on directory pages, robots.txt and the sitemap. They have to agree —
// a page that says noindex while the sitemap still advertises it is the kind of
// mixed signal that takes weeks to unpick.
//
// Turn on:  SEO_NOINDEX=1 in .env.local, then rebuild and restart.
// Turn off: remove the line, rebuild and restart.
//
// Deliberately opt-in. If this ever defaulted to on, a deploy that lost its
// env file would quietly de-index the whole site and nobody would notice until
// the traffic went.
const NOINDEX = process.env.SEO_NOINDEX === "1";

// Note on how this is enforced: crawlers are still ALLOWED to fetch the pages.
// That is not an oversight. A crawler that is blocked in robots.txt never
// fetches the page, never sees the noindex, and so anything already in the
// index just sits there. Blocking and de-indexing are opposite instructions;
// to remove pages you must let the crawler in and tell it to drop them.
const ROBOTS_META = NOINDEX
  ? { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } }
  : undefined;

const ROBOTS_HEADER = "noindex, nofollow, noarchive";

module.exports = { NOINDEX, ROBOTS_META, ROBOTS_HEADER };
