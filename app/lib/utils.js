import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn class-name helper: merge conditional + conflicting Tailwind classes.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Build a click-to-chat https://wa.me/<number> link for a lead when WhatsApp is
// available. Prefers an explicit WhatsApp link captured during enrichment, then
// the digits from the registration check's whatsapp_id ("<digits>@c.us"), then a
// bare number stored on the lead. Returns "" when there's nothing to link to.
export function waMeLink(lead) {
  if (!lead) return "";
  const raw = String(lead.whatsapp || "").trim();
  if (/wa\.me|api\.whatsapp\.com|whatsapp\.com\/send/i.test(raw)) {
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }
  const fromId = String(lead.whatsapp_id || lead.whatsappId || "").split("@")[0].replace(/\D/g, "");
  if (fromId.length >= 7) return `https://wa.me/${fromId}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 7) return `https://wa.me/${digits}`;
  return "";
}

// Google Maps link for a lead. Prefers the canonical listing URL captured by the
// scraper, but never returns nothing: live-search and warehouse leads often
// arrive without one, and "no link at all" is worse than a search that lands on
// the right place. Name + address is specific enough to resolve the business.
export function mapsLink(lead) {
  if (!lead) return "";
  const direct = String(lead.mapsUrl || lead.maps_url || "").trim();
  if (direct) return /^https?:\/\//i.test(direct) ? direct : `https://${direct}`;
  const query = [lead.name, lead.address || lead.city].filter(Boolean).join(" ").trim();
  if (!query) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// True when the link above is the real captured listing rather than a search we
// synthesised — lets the UI label it honestly.
export function hasDirectMapsLink(lead) {
  return !!String(lead?.mapsUrl || lead?.maps_url || "").trim();
}

// Human-friendly enrichment status for display. Hides raw network/error codes
// (e.g. "error: ENOTFOUND") that may still linger in older cached results — to
// the user, a site we couldn't read simply means no email was found. Returns ""
// for a lead that was never enriched.
export function prettyEnrichStatus(status) {
  const s = String(status || "").trim();
  if (!s) return "";
  // "no website" is accurate about *why* enrichment couldn't run, but this
  // status renders under a lead's contact/email info, where "no website"
  // reads as a non sequitur — say what's actually missing there: an email.
  if (/^no website$/i.test(s)) return "no email found";
  if (/^error\b/i.test(s) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|certificate|socket hang up|timeout/i.test(s)) {
    return "no email found";
  }
  return s;
}

// Normalize a lead's WhatsApp registration result to a badge state, handling
// both data shapes used across the app:
//   - DB-backed leads carry the descriptive `whatsapp_status` ("on whatsapp",
//     "not on whatsapp", "no phone", "error: ...").
//   - Captured/realtime dashboard rows carry `whatsappExists` ("yes" | "no").
// Returns "yes" | "no" | "other" | null (null = never checked).
export function waState(lead) {
  if (!lead) return null;
  const exists = String(lead.whatsappExists || "").toLowerCase();
  if (exists === "yes") return "yes";
  if (exists === "no") return "no";
  const s = String(lead.whatsapp_status || "").toLowerCase();
  if (!s) return null;
  if (s === "yes" || s.startsWith("on whatsapp")) return "yes";
  if (s === "no" || s.startsWith("not on whatsapp")) return "no";
  return "other"; // no phone / pending / error
}
