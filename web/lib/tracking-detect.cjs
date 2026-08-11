// Marketing-stack detector — reads a business's homepage HTML and reports which
// ad pixels, analytics tags, site platform and marketing tools it runs.
//
// Why this matters for someone selling to these leads: the pixels a business has
// (or is missing) are the pitch. A plumber running a Meta Pixel is already buying
// ads and can be sold retargeting; a plumber with a website and NO pixel at all
// is "you're paying for clicks you can never follow up with". Same for analytics.
// So the detector reports both what's present and, via missing(), what isn't.
//
// Pattern matching over the raw HTML only — no browser, no extra requests. It
// runs on HTML enrich.cjs has already fetched, so it costs nothing extra. That
// means tags injected client-side by a tag manager are not seen directly, but
// the loader script for every one of them IS in the HTML, which is what we match.

// [regex, display name] — grouped by what the signal tells you about the lead.
const AD_PIXELS = [
  [/connect\.facebook\.net|fbevents\.js|fbq\s*\(\s*['"]init|facebook\.com\/tr\?/i, "Meta Pixel"],
  [/googleadservices\.com|googlesyndication\.com|gtag\s*\(\s*['"]config['"]\s*,\s*['"]AW-|\/pagead\/conversion/i, "Google Ads"],
  [/analytics\.tiktok\.com|ttq\.load|tiktok.*pixel/i, "TikTok Pixel"],
  [/snap\.licdn\.com|linkedin.*insight|_linkedin_partner_id/i, "LinkedIn Insight"],
  [/sc-static\.net\/scevent|snaptr\s*\(/i, "Snap Pixel"],
  [/ct\.pinterest\.com|pintrk\s*\(/i, "Pinterest Tag"],
  [/static\.ads-twitter\.com|twq\s*\(/i, "X (Twitter) Pixel"],
  [/bat\.bing\.com|uetq/i, "Microsoft Ads (UET)"],
  [/tags\.srv\.stackadapt|stackadapt/i, "StackAdapt"],
  [/rlcdn\.com|adroll/i, "AdRoll"],
];

const ANALYTICS = [
  [/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i, "Google Tag Manager"],
  [/gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-|googletagmanager\.com\/gtag\/js\?id=G-/i, "Google Analytics 4"],
  [/google-analytics\.com\/analytics\.js|ga\s*\(\s*['"]create['"]|UA-\d{4,}-\d/i, "Universal Analytics (legacy)"],
  [/clarity\.ms/i, "Microsoft Clarity"],
  [/static\.hotjar\.com|hjSiteSettings/i, "Hotjar"],
  [/plausible\.io\/js/i, "Plausible"],
  [/cdn\.usefathom\.com/i, "Fathom"],
  [/matomo\.js|piwik\.js/i, "Matomo"],
  [/cdn\.mxpnl\.com|mixpanel/i, "Mixpanel"],
  [/segment\.(com|io)\/analytics\.js/i, "Segment"],
];

const PLATFORMS = [
  [/cdn\.shopify\.com|shopify\.theme|Shopify\.shop/i, "Shopify"],
  [/\/wp-content\/|\/wp-includes\/|wp-json/i, "WordPress"],
  [/static\.parastorage\.com|wix\.com|wixstatic\.com/i, "Wix"],
  [/squarespace\.com|static1\.squarespace/i, "Squarespace"],
  [/assets\.website-files\.com|webflow\.(com|io)/i, "Webflow"],
  [/img1\.wsimg\.com|godaddy.*website-builder|\.godaddysites\.com/i, "GoDaddy Builder"],
  [/duda(one)?\.com|dmws\.cloud/i, "Duda"],
  [/weebly\.com|editmysite\.com/i, "Weebly"],
  [/\/_next\/static\//i, "Next.js"],
];

const MARKETING = [
  [/js\.hs-scripts\.com|hsforms\.net|hubspot/i, "HubSpot"],
  [/static\.klaviyo\.com|klaviyo\.js/i, "Klaviyo"],
  [/chimpstatic\.com|mailchimp|list-manage\.com/i, "Mailchimp"],
  [/activehosted\.com|prism\.app-us1/i, "ActiveCampaign"],
  [/js\.convertkit|ck\.page/i, "ConvertKit"],
  [/omappapi\.com|optinmonster/i, "OptinMonster"],
  [/privy\.com|privymktg/i, "Privy"],
];

const COMMERCE = [
  [/\/wp-content\/plugins\/woocommerce|woocommerce/i, "WooCommerce"],
  [/js\.stripe\.com/i, "Stripe"],
  [/paypal(objects)?\.com/i, "PayPal"],
  [/squareup\.com|square\.site/i, "Square"],
  [/assets\.calendly\.com|calendly\.com\/assets/i, "Calendly"],
  [/acuityscheduling\.com/i, "Acuity Scheduling"],
  [/book(ing)?\.setmore|setmore\.com/i, "Setmore"],
  [/mindbodyonline\.com/i, "Mindbody"],
];

const GROUPS = [
  ["adPixels", AD_PIXELS],
  ["analytics", ANALYTICS],
  ["platform", PLATFORMS],
  ["marketing", MARKETING],
  ["commerce", COMMERCE],
];

function matchGroup(html, patterns) {
  const hits = [];
  for (const [re, name] of patterns) {
    if (re.test(html) && !hits.includes(name)) hits.push(name);
  }
  return hits;
}

// detectTracking(html) -> { adPixels, analytics, platform, marketing, commerce }
// Every value is an array of display names, empty when nothing matched. Pass the
// homepage HTML; concatenating a couple of crawled pages is fine too.
function detectTracking(html) {
  const out = {};
  for (const [key] of GROUPS) out[key] = [];
  if (!html || typeof html !== "string") return out;
  // Cap the scan: homepages with a megabyte of inline JSON blow up the regex
  // pass for no benefit — every loader tag lives near the top or in <head>.
  const text = html.length > 600000 ? html.slice(0, 600000) : html;
  for (const [key, patterns] of GROUPS) out[key] = matchGroup(text, patterns);
  return out;
}

// The gaps, phrased as the reason to call them. Only meaningful for a lead that
// actually has a website — a business with no site at all is a different pitch.
function missing(tracking) {
  const t = tracking || {};
  const gaps = [];
  if (!(t.adPixels || []).length) gaps.push("No ad pixel — can't retarget visitors");
  if (!(t.analytics || []).length) gaps.push("No analytics — traffic is unmeasured");
  if (!(t.marketing || []).length) gaps.push("No email capture on site");
  return gaps;
}

// Flatten to a single "Meta Pixel, GA4, WordPress" style line for CSV export and
// table cells, in the order a seller cares about.
function summarize(tracking) {
  const t = tracking || {};
  return [...(t.adPixels || []), ...(t.analytics || []), ...(t.platform || []), ...(t.marketing || []), ...(t.commerce || [])]
    .join(", ");
}

// Storage helpers — the lead row keeps this as one JSON text column.
function serialize(tracking) {
  if (!tracking) return "";
  const any = GROUPS.some(([k]) => (tracking[k] || []).length);
  return any ? JSON.stringify(tracking) : "";
}

function parse(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { detectTracking, missing, summarize, serialize, parse, GROUPS };
