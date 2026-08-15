// Landing content that more than one place needs.
//
// Deliberately not inside Landing.js: that file is "use client", and the FAQ
// also has to be readable by the server component that emits the FAQPage
// structured data. One copy, so the rich result and the visible accordion can
// never drift apart - Google treats a mismatch between them as a violation.

export const FAQ = [
  { q: "Do I need to install anything?", a: "You sign in with Google, no account setup beyond that. Most searches are answered straight from leads we already hold. For a city or niche we haven't indexed yet, you'll need the free Chrome extension: it runs that search live on your own machine instead of putting you in a queue." },
  { q: "How fast do leads actually arrive?", a: "Most searches are answered from leads we already hold and land in a few seconds. A search that has to be collected fresh runs through the Chrome extension on your own machine, so it needs that tab open until the job finishes." },
  { q: "Where do the leads come from?", a: "Public business listings for the niche and location you pick. We then visit each business's own website and pull emails, social profiles and WhatsApp numbers from it, which is where most of the contact detail comes from." },
  { q: "Can I send leads straight to my CRM or cold-email tool?", a: "Yes. Connect Smartlead, Instantly, HubSpot or Pipedrive with an API key, or point a webhook at Zapier, Make or n8n to reach almost anything else. Select the leads you want, choose the integration, and they are pushed across in the background. Re-pushing the same list is safe: leads already there are updated rather than duplicated." },
  { q: "What is a credit, and what does each action cost?", a: "Finding a lead costs 1 credit, a quick audit 3, a chatbot scan 5 and a full website report 10. Anything you do to a lead you already own is free, so going back over your own list never costs you twice." },
  { q: "What does the website audit check?", a: "We open the site in a real Chrome browser and check SSL, load speed, mobile layout and whether the business runs a chatbot. It is the quickest way to find the businesses whose site is broken, slow or missing altogether." },
  { q: "Can I organise leads, or only export them?", a: "Both. Leads go into named lists, anything you are actively chasing sits on your watch list, and every lead carries an outreach status. A deduped CSV export is available whenever you want one." },
  { q: "How does billing work, and is there a free plan?", a: "Yes, the Starter plan needs no card and includes enough credits to run real searches and export what you find. Paid plans are monthly and billed through Whop, so you can upgrade, downgrade or cancel at any time with no contract." },
  { q: "Is my data safe?", a: "Every account's leads, lists and projects are isolated from every other account. We do not share or resell anything you collect. Integration API keys are stored encrypted and are never shown back to you in full." },
];

// The tools a finished list can be pushed into.
//
// Rendered as brand-coloured wordmarks rather than glyph marks: only some of
// these publish a reusable SVG mark, and a strip that mixed four real logos
// with three invented ones would look broken. A wordmark is also the more
// recognisable form for the smaller names. Drop real SVGs into
// public/brand/integrations/ and swap `tint` for an <Image> when they exist.
export const INTEGRATIONS = [
  { name: "Smartlead", tint: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/25", note: "Cold email" },
  { name: "Instantly", tint: "text-violet-600 dark:text-violet-400", ring: "ring-violet-500/25", note: "Cold email" },
  { name: "HubSpot", tint: "text-orange-600 dark:text-orange-400", ring: "ring-orange-500/25", note: "CRM" },
  { name: "Pipedrive", tint: "text-sky-600 dark:text-sky-400", ring: "ring-sky-500/25", note: "CRM" },
  { name: "n8n", tint: "text-rose-600 dark:text-rose-400", ring: "ring-rose-500/25", note: "Webhook" },
  { name: "Zapier", tint: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/25", note: "Webhook" },
  { name: "Make", tint: "text-indigo-600 dark:text-indigo-400", ring: "ring-indigo-500/25", note: "Webhook" },
];
