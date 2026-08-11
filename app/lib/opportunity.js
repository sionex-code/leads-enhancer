// Opportunity score — how good a business is as a *prospect*, 0-100.
//
// The insight this encodes: for someone selling marketing/web services, a
// business's weaknesses are the pitch. No website, no ad pixel, no reviews, a
// weak rating — each is a concrete thing you can open a conversation with. So
// gaps push the score UP.
//
// The part that makes the number mean something: it is scored only over the
// signals we actually KNOW for that lead. An un-enriched lead has no idea
// whether the site runs a Meta Pixel, so that signal is not counted as "clean"
// (which would quietly deflate every score toward the same value) and not
// counted as "missing" either (which would inflate them all). Each signal
// declares itself known or unknown; the score is the earned fraction of the
// available weight, and `coverage` reports how much of the picture we have. Two
// leads scoring 70 with 30% and 90% coverage are different propositions, and the
// UI says so instead of showing one flat number.
//
// Every signal that fires also produces a plain-English reason — the number
// alone tells you nothing you can say on a call.

import trackingDetect from "../../web/lib/tracking-detect.cjs";

function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Review count, distinguishing "zero reviews" from "we never captured it".
// Maps listings scraped without a review count leave the field empty, and
// treating that as a confirmed zero was what made every score identical.
function reviewsOf(lead) {
  const raw = lead?.reviews;
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// Socials are only meaningful once the site has been crawled — before that,
// empty columns mean "not looked yet", not "no Facebook page".
//
// Exported because the UI needs the same answer: coverage is NOT a proxy for
// "has this been enriched". An enriched lead whose site was unreachable, or that
// has no website at all, still scores low coverage because the tracking and
// site-health signals stay unknown — so prompting on coverage told people to run
// Enrich on leads that had already been enriched.
export function isEnriched(lead) {
  return !!(lead?.enrichStatus || lead?.enrich_status || lead?.email || lead?.tech);
}
const enriched = isEnriched;

// Each signal: weight (how much it matters), known (do we have the data), value
// (0 = no opportunity here, 1 = wide open), reason (what to say on the call).
function signalsFor(lead) {
  const out = [];
  const push = (key, weight, known, value, reason) =>
    out.push({ key, weight, known, value: known ? value : 0, reason: known && value >= 0.5 ? reason : null });

  const website = lead.website;
  const tracking = trackingDetect.parse(lead.tech);
  const reviews = reviewsOf(lead);
  const rating = num(lead.rating);
  const isEnriched = enriched(lead);

  // --- web presence ---------------------------------------------------------
  push("website", 25, true, website ? 0 : 1, "No website — biggest gap to sell into");

  // Tracking only counts once the site has actually been crawled.
  push("adPixel", 12, !!(website && tracking), tracking && !(tracking.adPixels || []).length ? 1 : 0,
    "No ad pixel — can't retarget visitors");
  push("analytics", 8, !!(website && tracking), tracking && !(tracking.analytics || []).length ? 1 : 0,
    "No analytics — traffic is unmeasured");
  push("emailCapture", 4, !!(website && tracking), tracking && !(tracking.marketing || []).length ? 1 : 0,
    "No email capture on the site");

  // --- site health (only when audited) --------------------------------------
  const perf = num(lead.desktop?.performance ?? lead.desktop_performance);
  push("performance", 10, perf !== null, perf === null ? 0 : perf < 50 ? 1 : perf < 75 ? 0.6 : 0.1,
    perf !== null ? `Slow website (performance ${Math.round(perf)}/100)` : null);

  const httpStatus = num(lead.httpStatus ?? lead.http_status);
  push("siteUp", 10, httpStatus !== null, httpStatus !== null && httpStatus >= 400 ? 1 : 0,
    httpStatus !== null ? `Website is down or erroring (HTTP ${httpStatus})` : null);

  // --- social proof ---------------------------------------------------------
  const hasSocial = !!(lead.facebook || lead.instagram || lead.linkedin || lead.twitter || lead.tiktok || lead.youtube);
  push("socials", 10, isEnriched, hasSocial ? 0 : 1, "No social profiles found");

  push("reviewVolume", 12, reviews !== null,
    reviews === null ? 0 : reviews === 0 ? 1 : reviews < 10 ? 0.75 : reviews < 50 ? 0.4 : reviews < 200 ? 0.2 : 0.05,
    reviews === 0 ? "No reviews yet" : `Only ${reviews} review${reviews === 1 ? "" : "s"}`);

  push("rating", 10, rating !== null,
    rating === null ? 0 : rating < 3.5 ? 1 : rating < 4 ? 0.75 : rating < 4.5 ? 0.45 : rating < 4.8 ? 0.25 : 0.1,
    rating !== null ? `Rating of ${rating} leaves room to improve` : null);

  const ownerReplied = lead.ownerReplied ?? lead.owner_replied;
  push("ownerReply", 4, ownerReplied === 0 || ownerReplied === 1, ownerReplied === 0 ? 1 : 0,
    "Owner never replies to reviews");

  // --- listing completeness -------------------------------------------------
  const listingFields = [lead.address, lead.hours, lead.website, lead.category];
  const missingCount = listingFields.filter((v) => !v).length;
  push("listing", 6, true, missingCount / listingFields.length,
    `Incomplete Maps listing (${missingCount} of ${listingFields.length} details missing)`);

  return out;
}

// scoreLead(lead) -> { score, band, reasons, coverage, contactable, signals }
export function scoreLead(lead) {
  if (!lead) return { score: 0, band: "low", reasons: [], coverage: 0, contactable: false, signals: [] };

  const signals = signalsFor(lead);
  const known = signals.filter((s) => s.known);
  const availableWeight = known.reduce((sum, s) => sum + s.weight, 0);
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const earned = known.reduce((sum, s) => sum + s.weight * s.value, 0);

  // Smooth toward "unknown" rather than toward "clean". Without this, a lead we
  // have barely checked scores near zero purely because most signals are
  // unavailable — which reads as "not worth calling" when it actually means "not
  // looked at yet", and made the whole column collapse into two clusters. Mixing
  // in a neutral prior weighted like one major signal pulls thin leads toward the
  // middle and lets well-covered leads reach the extremes they have earned.
  const PRIOR_WEIGHT = 25;
  const PRIOR_VALUE = 0.5;
  let score = Math.round(
    ((earned + PRIOR_WEIGHT * PRIOR_VALUE) / (availableWeight + PRIOR_WEIGHT)) * 100
  );

  // Reachability is a gate, not an opportunity: a business you cannot contact is
  // not a prospect however many gaps it has.
  const hasPhone = !!lead.phone;
  const hasEmail = !!(lead.email || lead.allEmails || lead.all_emails);
  const contactable = hasPhone || hasEmail;
  if (!contactable) score = Math.min(score, 35);

  score = Math.max(0, Math.min(100, score));

  // Reasons ordered by how much they actually moved the number.
  const reasons = known
    .filter((s) => s.reason)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .map((s) => s.reason);
  if (!contactable) reasons.push("No phone or email — hard to reach");

  return {
    score,
    band: score >= 65 ? "high" : score >= 40 ? "medium" : "low",
    reasons,
    // How much of the picture we have, 0-100. Low coverage means "enrich this
    // lead before trusting the number".
    coverage: totalWeight > 0 ? Math.round((availableWeight / totalWeight) * 100) : 0,
    contactable,
    signals,
  };
}

export const BAND_LABEL = { high: "High", medium: "Medium", low: "Low" };

export const BAND_CLASS = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
};

export const BAND_RING = {
  high: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  medium: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  low: "border-border text-muted-foreground",
};

// Shared copy for the (i) in the Opportunity column header and the drawer.
export const OPPORTUNITY_HELP = [
  "How likely this business is to need what you sell — higher means more to fix.",
  "It rewards gaps you can act on: no website, no ad pixel or analytics, no social profiles, few or no reviews, a weak rating, a slow or broken site, and an incomplete Maps listing.",
  "Only signals we have actually captured are scored, so an un-enriched lead is never marked 'clean' by default. Coverage tells you how much of the picture that score is based on — run Enrich to raise it.",
  "A business with no phone and no email is capped at 35 however many gaps it has, because you cannot reach it.",
  "Thinly-checked leads sit near the middle rather than at zero — a low score means 'few gaps found', not 'not looked at'.",
];
