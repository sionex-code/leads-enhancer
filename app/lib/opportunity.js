// Opportunity scoring for client components.
//
// The logic itself lives in web/lib/opportunity.cjs, because the leads table
// pages server-side and so the API has to compute the very same score to order
// by it. Re-exported rather than duplicated: two copies of these weights would
// drift, and the sort order would stop matching the number in the column.
import opportunity from "../../web/lib/opportunity.cjs";

export const scoreLead = opportunity.scoreLead;
export const isEnriched = opportunity.isEnriched;
export const BAND_LABEL = opportunity.BAND_LABEL;
export const BAND_CLASS = opportunity.BAND_CLASS;
export const BAND_RING = opportunity.BAND_RING;
export const OPPORTUNITY_HELP = opportunity.OPPORTUNITY_HELP;
