"use strict";

// One place that decides whether a social URL is a real business profile.
//
// It used to live only in the crawler, and only rejected the obvious cases:
// login pages, share dialogs, /profile.php with no id. That let through
// "https://facebook.com/people" — Facebook's directory index, not anybody's
// page — which then rendered as a Facebook icon on a lead and sent the user
// nowhere. The other extraction path (site-report) validated nothing at all,
// and the icon row rendered any non-empty string.
//
// So the rule is stated once, here, and applied at every point a social URL
// enters or leaves the system: extraction, the report crawler, and render.

// Path heads that belong to the platform rather than to anybody's profile.
// These are the ones that look like handles and aren't. "people" is why this
// file exists.
const RESERVED = {
  facebook: new Set([
    "people", "pages", "groups", "share", "sharer", "pg", "photo", "photos",
    "video", "videos", "events", "marketplace", "watch", "gaming", "story.php",
    "permalink.php", "sharer.php", "dialog", "plugins", "tr", "search", "hashtag",
    "login", "recover", "help", "policies", "legal", "business", "ads", "careers",
  ]),
  instagram: new Set([
    "explore", "accounts", "p", "reel", "reels", "stories", "tv", "direct",
    "about", "developer", "legal", "privacy", "terms",
  ]),
  linkedin: new Set([
    "feed", "jobs", "learning", "events", "posts", "pulse", "shareArticle",
    "sharing", "uas", "checkpoint", "help", "legal", "signup", "login",
  ]),
  twitter: new Set([
    "home", "explore", "notifications", "messages", "settings", "search",
    "intent", "share", "i", "hashtag", "login", "signup", "privacy", "tos",
  ]),
  youtube: new Set(["watch", "embed", "results", "playlist", "feed", "shorts"]),
  tiktok: new Set(["explore", "foryou", "following", "live", "tag", "search", "legal"]),
  pinterest: new Set(["pin", "search", "categories", "today", "login", "about"]),
  telegram: new Set(["s", "share", "joinchat", "proxy"]),
  whatsapp: new Set([]),
};

// Anything matching these is platform machinery whatever the network.
const GENERIC_PATH = /\/(login|signup|register|oauth|auth|join|policies|help|support|terms|privacy|dialog|sharer|share|intent|plugins|widgets|embed)\b/i;
const TRACKING = /\/tr\?|[?&]_?tr=/i;

// A handle is a handle: letters, digits and a little punctuation, and long
// enough to be a name. One character is a typo or a truncation, not a business.
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,}$/;

// Networks whose real profiles legitimately sit deeper than one segment.
const DEEP = {
  linkedin: /^\/(company|in|school|showcase)\/[A-Za-z0-9._%-]{2,}/i,
  youtube: /^\/(@[A-Za-z0-9._-]{2,}|c\/[A-Za-z0-9._-]{2,}|channel\/[A-Za-z0-9_-]{2,}|user\/[A-Za-z0-9._-]{2,})/i,
  tiktok: /^\/@[A-Za-z0-9._-]{2,}/i,
  whatsapp: /^\/[0-9]{6,}/,
};

// Site-builder and platform accounts a CMS drops into its own footer. These are
// real profiles — just not the lead's.
const PLATFORM_ACCOUNT = /^(wix|wixcom|wordpress|wordpressdotcom|squarespace|godaddy|shopify|weebly|duda|webflow|app|home|null|undefined)$/i;

function isValidSocialUrl(url, network) {
  if (!url || typeof url !== "string") return false;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(u.protocol)) return false;

  const path = u.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return false; // a bare homepage is not a profile
  if (GENERIC_PATH.test(path)) return false;
  if (TRACKING.test(url)) return false;

  // Facebook's numeric-id form is real, but only with an id.
  if (network === "facebook" && /^\/profile\.php$/i.test(path)) {
    return !!u.searchParams.get("id");
  }

  const deep = DEEP[network];
  if (deep) return deep.test(path);

  const segments = path.split("/").filter(Boolean);
  const head = segments[0] || "";
  if (RESERVED[network] && RESERVED[network].has(head.toLowerCase())) return false;
  if (PLATFORM_ACCOUNT.test(head)) return false;
  if (!HANDLE.test(head)) return false;
  return true;
}

// Fold the variants that mean the same page onto one form, so the mobile host
// and a tracking-tagged copy don't read as two different profiles. Mobile
// Facebook links used not to match the extraction pattern at all and were
// dropped outright; they are the same page and are kept now.
function normalizeSocialUrl(url) {
  if (!url || typeof url !== "string") return "";
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return "";
  }
  u.hostname = u.hostname.replace(/^(www|m|mobile|[a-z]{2}-[a-z]{2})\./i, "");
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|igshid|ref|ref_src|ref_url|source|si)$/i.test(key)) {
      u.searchParams.delete(key);
    }
  }
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString().replace(/\?$/, "");
}

// Normalize first, then judge. Returns "" for anything that isn't a profile, so
// callers can assign the result straight onto a lead.
function cleanSocialUrl(url, network) {
  const normalized = normalizeSocialUrl(url);
  if (!normalized) return "";
  return isValidSocialUrl(normalized, network) ? normalized : "";
}

module.exports = { isValidSocialUrl, normalizeSocialUrl, cleanSocialUrl };
