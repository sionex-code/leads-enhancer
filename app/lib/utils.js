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
