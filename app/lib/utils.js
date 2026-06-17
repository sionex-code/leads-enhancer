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
