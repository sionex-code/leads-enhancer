"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  MapPin,
  Mail,
  MessageCircle,
  Phone,
  Globe2,
  Search,
  Star,
  Check,
  CheckCircle2,
  Plus,
  ArrowRight,
  Zap,
  Sparkles,
  Building2,
  Gauge,
  Database,
  ListChecks,
  Activity,
  Users,
  Rocket,
  Briefcase,
  ChevronDown,
  TrendingUp,
  Bell,
  Wand2,
  FileSpreadsheet,
  Menu,
  X,
  Share2,
  Plug,
} from "lucide-react";
import { FAQ, INTEGRATIONS } from "./landing-data";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button } from "./ui/button";
import RecentSearches from "./RecentSearches";
import useSignedIn, { appHref } from "../lib/useSignedIn";

// Faint diagonal hatch the template uses behind several light sections.
const HATCH =
  "[background-image:repeating-linear-gradient(45deg,hsl(var(--foreground)/0.022)_0,hsl(var(--foreground)/0.022)_1px,transparent_1px,transparent_11px)]";

/* ------------------------------------------------------------------ data -- */

const NAV = [
  { href: "#about", label: "About" },
  { href: "#features", label: "Features" },
  { href: "#integrations", label: "Integrations" },
  { href: "#reviews", label: "Reviews" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

// Quiet, uniform "About" tag-pills (one subtle style, brand dot only).
const PILLS = [
  { label: "Verified emails", desc: "Extract valid, deliverable emails directly from websites.", icon: Mail },
  { label: "WhatsApp numbers", desc: "Verify active WhatsApp numbers for direct outreach.", icon: MessageCircle },
  { label: "Website health", desc: "Check SSL, speed, and mobile friendliness instantly.", icon: Gauge },
  { label: "Owner contacts", desc: "Pinpoint owner and decision-maker details directly.", icon: Users },
  { label: "Social profiles", desc: "Gather Facebook, Instagram, and LinkedIn links.", icon: Globe2 },
  { label: "Ratings & reviews", desc: "Track ratings and reviews to find the best niches.", icon: Star },
  { label: "Phone numbers", desc: "Pull formatted phone numbers from listings and sites.", icon: Phone },
  { label: "CRM integrations", desc: "Push leads to Smartlead, Instantly, HubSpot or Pipedrive.", icon: Share2 },
];

// Sticky-left card stack. This section deliberately does NOT repeat the
// capability list from "Why LeadsFunda" above it: it walks one lead through the
// four stages it actually passes through inside the app, then explains what
// each stage costs, so the reader learns how the product works rather than
// reading a second grid of features.
const DISCOVER = [
  { icon: Search, tag: "Stage 1 · Search", title: "Answered from leads we already hold", body: "Most niche and city combinations come straight out of our index in a few seconds. When a search covers ground we have not collected yet, the browser extension runs it live on your own machine, so you never sit behind anyone else's job.", grad: "from-amber-50 to-amber-100/40", ring: "ring-amber-200/70", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-700" },
  { icon: Mail, tag: "Stage 2 · Enrich", title: "Contacts taken from their own website", body: "Every business we return gets crawled for emails, social profiles and a WhatsApp number. That is the difference between a list of map pins and a list you can actually send to on the day it arrives.", grad: "from-orange-50 to-orange-100/40", ring: "ring-orange-200/70", dot: "bg-orange-400", chip: "bg-orange-500/10 text-orange-700" },
  { icon: Gauge, tag: "Stage 3 · Qualify", title: "A real Chrome audit of their site", body: "SSL, load speed, mobile layout and whether they run a chatbot, checked in a real browser rather than guessed. The businesses with a broken site, or no site at all, are usually the easiest pitch, and the audit tells you which ones those are.", grad: "from-stone-50 to-stone-100/60", ring: "ring-stone-200/70", dot: "bg-stone-400", chip: "bg-stone-500/10 text-stone-700" },
  { icon: ListChecks, tag: "Stage 4 · Work it", title: "Lists, a watch list and outreach status", body: "Save leads into named lists, keep the ones you are chasing on your watch list, and mark where each conversation stands.", grad: "from-amber-50 to-orange-100/40", ring: "ring-orange-200/60", dot: "bg-primary", chip: "bg-primary/10 text-primary" },
  { icon: Share2, tag: "Stage 5 · Send", title: "Straight into the tool you send from", body: "Connect Smartlead, Instantly, HubSpot or Pipedrive with an API key, or point a webhook at Zapier, Make or n8n. Select the leads, pick the integration, and they are pushed across in the background while you carry on. Push the same list again and anything already there is updated, not duplicated.", grad: "from-emerald-50 to-emerald-100/40", ring: "ring-emerald-200/70", dot: "bg-emerald-400", chip: "bg-emerald-500/10 text-emerald-700" },
  { icon: Database, tag: "What it costs", title: "Credits, charged only for new work", body: "One credit finds a lead, a quick audit is three, a chatbot scan is five and a full website report is ten. Going back over a lead you already own costs nothing, so your own list stays free to revisit as often as you like.", grad: "from-stone-50 to-stone-100/60", ring: "ring-stone-200/70", dot: "bg-stone-400", chip: "bg-stone-500/10 text-stone-700" },
];

const STATS = [
  { v: "40M", l: "Leads scraped" },
  { v: "190+", l: "Niches covered" },
  { v: "9", l: "Socials per lead" },
  { v: "< 5s", l: "Average delivery" },
];

const STEPS = [
  { n: "01", icon: Search, title: "Pick a niche & city", body: "Choose a service and location, or paste your own search query, then set how many leads you want." },
  { n: "02", icon: Zap, title: "We scrape & enrich", body: "We pull every business, then crawl their sites for emails, socials and WhatsApp, automatically." },
  { n: "03", icon: ListChecks, title: "Send them where you sell", body: "Filter, audit websites, mark outreach status, then push straight into Smartlead, Instantly, HubSpot or Pipedrive - or export a clean CSV." },
];

const FACES = [
  "/avatars/women-44.jpg",
  "/avatars/men-32.jpg",
  "/avatars/women-68.jpg",
  "/avatars/men-76.jpg",
  "/avatars/women-90.jpg",
  "/avatars/men-12.jpg",
];

const TESTIMONIALS = [
  { name: "Marcus D.", handle: "@agencymarcus", img: "/avatars/men-32.jpg", body: "Pulled 1,200 plumbers in an afternoon and half had no website, an instant pitch list. Made my job much easier." },
  { name: "Priya N.", handle: "@priyasells", img: "/avatars/women-44.jpg", body: "The email + WhatsApp enrichment sold me. My list is ready to outreach the second it lands." },
  { name: "Tom R.", handle: "@tomdesigns", img: "/avatars/men-76.jpg", body: "Website health scoring tells me exactly who to call first. A game-changer for cold outreach." },
  { name: "Lena K.", handle: "@lenagrowth", img: "/avatars/women-68.jpg", body: "I cancelled three tools after switching. Scrape, enrich and audit all in one tab." },
  { name: "Sergio A.", handle: "@sergioleads", img: "/avatars/men-12.jpg", body: "Runs in the cloud, so I close the laptop and the leads are waiting when I'm back." },
  { name: "Dana W.", handle: "@danaops", img: "/avatars/women-90.jpg", body: "Cleanest CSV exports I've used. Straight into my CRM, with zero cleanup." },
];

const PLANS = [
  { id: "free", name: "Starter", price: 0, sub: "Kick the tires, no card", quota: "Starter credits",
    perks: ["Starter credits", "Find + preview leads", "Basic enrichment", "CSV export"],
    cta: "Get started", callbackUrl: "/dashboard", style: "light" },
  { id: "p19", name: "Starter", price: 19, sub: "For solo prospectors", quota: "5,000 credits / month",
    perks: ["5,000 credits / mo", "20 searches + 400 leads / day", "Email + social enrichment", "Website health checks"],
    cta: "Get Starter", callbackUrl: "/billing?plan=p19", style: "light" },
  { id: "p35", name: "Growth", price: 35, sub: "For steady outreach", quota: "50,000 credits / month", popular: true,
    perks: ["50,000 credits / mo", "100 searches + 1,500 leads / day", "Everything in Starter", "Priority in the job queue"],
    cta: "Get Growth", callbackUrl: "/billing?plan=p35", style: "blue" },
  { id: "p49", name: "Scale", price: 49, sub: "For agencies at volume", quota: "Unlimited credits / month",
    perks: ["Unlimited credits / mo", "1,000 searches + 5,000 leads / day", "Everything in Growth", "Highest queue priority"],
    cta: "Get Scale", callbackUrl: "/billing?plan=p49", style: "dark" },
];

const PLAN_ICONS = { free: Rocket, p19: Sparkles, p35: Star, p49: Briefcase };

// FAQ and INTEGRATIONS now live in ./landing-data so the server component can
// emit matching structured data from the same source.

// Mock data for the product-window collage. The businesses are deliberately the
// standard fictional-company names, on 555-01xx numbers and @example.com, so
// nothing here can be mistaken for a real company's listing or contact details.
const SCRAPE_FEED = [
  { n: "Acme Plumbing Co.", m: "(512) 555-0182", r: "4.8", bad: true },
  { n: "Northwind HVAC", m: "(512) 555-0143", r: "4.6", bad: false },
  { n: "Contoso Roofing Co.", m: "(512) 555-0117", r: "4.9", bad: true },
  { n: "Fabrikam Electric", m: "(512) 555-0164", r: "4.4", bad: false },
];

/* --------------------------------------------------------------- helpers -- */

// Scroll-reveal: fades + slides children up the first time they enter view.
function Reveal({ children, className = "", delay = 0 }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}

// Every call to action on this page, in one component.
//
// Signed out it is the Google button, which hands off to the app host's /login.
// Signed in it is a plain link to wherever that button would have landed you
// anyway - because asking a customer who is already signed in to "Continue with
// Google" sends them through a whole OAuth round-trip to arrive exactly where a
// link would have put them.
//
// `signedInLabel` exists for the pricing cards: "Get Growth" still says "Get
// Growth" once you're signed in, it just goes straight to checkout.
function Cta({
  signedIn,
  callbackUrl = "/dashboard",
  signedInLabel,
  children,
  size,
  variant,
  className,
}) {
  if (signedIn) {
    return (
      <Button asChild size={size} variant={variant} className={className}>
        <a href={appHref(callbackUrl)}>
          {signedInLabel || children}
          <ArrowRight className="h-4 w-4" />
        </a>
      </Button>
    );
  }
  return (
    <GoogleSignInButton
      callbackUrl={callbackUrl}
      size={size}
      variant={variant}
      className={className}
    >
      {children}
    </GoogleSignInButton>
  );
}

// Small pill eyebrow with icon, used above every section heading.
function Eyebrow({ icon: Icon = Sparkles, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground/70 shadow-sm">
      <Icon className="h-3.5 w-3.5 text-primary" /> {children}
    </span>
  );
}

function Stars({ className = "h-3.5 w-3.5" }) {
  return (
    <div className="flex items-center gap-0.5 text-flare">
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} className={`${className} fill-current`} />)}
    </div>
  );
}

// Hand-drawn underline under the last word of the headline.
//
// Drawn rather than a straight border because a ruled line under a display
// heading reads as a text link. The stroke tapers - two curves filled, not one
// stroked path - so it keeps the marker-pen quality at any width.
function Swoosh({ className = "" }) {
  return (
    <svg
      viewBox="0 0 120 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.5 8.6c18-4.6 40-6.6 60-6.6s39 2.3 57.2 6.2c-19-2-38-3-57-3s-40.4 1.3-60.2 3.4z"
        fill="hsl(var(--flare-soft))"
      />
    </svg>
  );
}

// The soft geometry behind the hero: a warm wash top-right, faint concentric
// rings bleeding off the left edge, two dot grids and one flare tile.
//
// All of it is pointer-events-none and aria-hidden - it is texture, and it must
// never intercept a click meant for the search box sitting on top of it.
function HeroDecor() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* Warm wash, top right. */}
      <div className="absolute -right-40 -top-56 h-[30rem] w-[30rem] rounded-full bg-flare-tint/45 blur-3xl" />
      {/* Concentric rings, running off the left edge. */}
      <svg
        className="absolute -left-[19rem] top-16 hidden h-[30rem] w-[30rem] text-flare-soft/25 md:block"
        viewBox="0 0 400 400"
        fill="none"
      >
        {[110, 150, 190, 230].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
      </svg>
      {/* Dot grids: one left of the headline, one right. */}
      <DotGrid className="absolute left-[15%] top-[27%] hidden text-muted-foreground/25 lg:block" cols={3} rows={3} />
      <DotGrid className="absolute right-[9%] top-[25%] hidden text-flare/45 xl:block" cols={6} rows={4} />
      {/* Single flare tile. */}
      <div className="absolute left-[2.5%] top-[27%] hidden h-10 w-10 rotate-[8deg] rounded-xl bg-flare-tint lg:block" />
      <div className="absolute left-[13.5%] top-[34%] hidden h-4 w-4 rounded-md bg-flare-tint lg:block" />
    </div>
  );
}

function DotGrid({ className = "", cols = 4, rows = 3 }) {
  return (
    <svg
      className={className}
      width={cols * 20}
      height={rows * 20}
      aria-hidden="true"
    >
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <circle key={`${r}-${c}`} cx={c * 20 + 2} cy={r * 20 + 2} r="2" fill="currentColor" />
        )),
      )}
    </svg>
  );
}

function AvatarStack() {
  return (
    <div className="flex -space-x-3">
      {FACES.slice(0, 3).map((src) => (
        <Image key={src} src={src} alt="" width={32} height={32} className="h-10 w-10 rounded-full border-2 border-card object-cover shadow-sm" />
      ))}
    </div>
  );
}

// Official LeadsFunda wordmark (blue + dark ink, made for light backgrounds).
// viewBox is 683.78 x 132.24, so width = height * 5.17.
// The wordmark is a home link, which on the home page means "back to the top".
// It rendered as a bare image before, so clicking the most obviously clickable
// thing on the page did nothing at all.
function Logo({ height = 28, className = "", asLink = true }) {
  const toTop = (e) => {
    // Only intercept when we are already here; anywhere else the href is right.
    if (typeof window === "undefined" || window.location.pathname !== "/") return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const img = (
    <Image
      src="/brand/leadsfunda-white.svg"
      alt="LeadsFunda"
      width={145}
      height={28}
      priority
      className={`h-[20px] w-auto sm:h-[28px] sm:w-auto ${className}`}
    />
  );
  // The hero renders a picture of the app, and the wordmark inside that picture
  // is part of the illustration - clicking it should do nothing.
  if (!asLink) return img;
  return (
    <a href="/" onClick={toTop} aria-label="LeadsFunda home" className="inline-flex items-center">
      {img}
    </a>
  );
}

// Section heading block (centered eyebrow + title + lead).
function SectionHead({ eyebrow, icon, title, sub, className = "" }) {
  return (
    <div className={`mx-auto max-w-2xl text-center ${className}`}>
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <h2 className="font-heading mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ----------------------------------------------------- hero app collage -- */

// A floating frosted card that overlaps the product window (desktop only).
function FloatCard({ className = "", delay = 0, children }) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`absolute z-20 hidden rounded-2xl border border-border bg-card/95 p-4 shadow-2xl shadow-black/10 backdrop-blur-md lg:block ${className}`}
    >
      {children}
    </div>
  );
}

function HeroApp() {
  return (
    <div className="container relative max-w-[74.5rem] pb-8">
      {/* lime glow under the window */}
      <div className="pointer-events-none absolute -inset-x-10 -bottom-10 top-10 -z-10 rounded-[3rem] bg-gradient-to-tr from-primary/15 via-flare-tint/60 to-flare/25 blur-3xl" />

      {/* floating overlap cards */}
      <FloatCard className="-left-14 top-[58%] w-60" delay={0}>
        <div className="text-xs font-semibold text-muted-foreground">Credits this month</div>
        <div className="mt-3 space-y-3">
          {[{ l: "Searches", p: "62%", c: "bg-primary" }, { l: "Leads", p: "48%", c: "bg-[#e0a412]" }].map((b) => (
            <div key={b.l}>
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>{b.l}</span></div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div className={`h-1.5 rounded-full ${b.c}`} style={{ width: b.p }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-sm font-bold text-foreground">1,284 <span className="font-medium text-muted-foreground">leads found</span></div>
      </FloatCard>

      <FloatCard className="-right-8 top-40 w-64" delay={900}>
        {/* Labelled so the placeholder business reads as a sample lead, not a real one. */}
        <div className="mb-2.5 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Example lead
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">Contoso Roofing Co.</div>
            <div className="text-[11px] text-muted-foreground">Austin, TX · ★ 4.9</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <Mail className="h-3.5 w-3.5 text-primary" /><span className="truncate text-foreground">hello@example.com</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[{ t: "No SSL", c: "bg-rose-500/10 text-rose-600" }, { t: "Slow site", c: "bg-amber-500/10 text-amber-600" }, { t: "No chatbot", c: "bg-stone-500/10 text-stone-700" }].map((tag) => (
            <span key={tag.t} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag.c}`}>{tag.t}</span>
          ))}
        </div>
      </FloatCard>

      {/* the browser window */}
      <div className="overflow-hidden rounded-[1.6rem] border border-border bg-card shadow-2xl shadow-primary/10">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-rose-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <div className="mx-auto flex items-center gap-2 rounded-full bg-background/70 px-4 py-1 text-xs text-muted-foreground">
            <Globe2 className="h-3 w-3" /> app.leadsfunda.com
          </div>
        </div>

        <div className="flex">
          {/* sidebar */}
          <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-muted/20 p-4 sm:flex">
            <Logo height={18} asLink={false} />
            <button className="mt-5 flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm">
              <Plus className="h-4 w-4" /> New scrape
            </button>
            <nav className="mt-4 space-y-1 text-sm">
              {[{ i: Search, l: "Find leads", on: true }, { i: Database, l: "All leads" }, { i: Star, l: "Watchlist" }].map((it) => (
                <div key={it.l} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${it.on ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}>
                  <it.i className="h-4 w-4" /> {it.l}
                </div>
              ))}
            </nav>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Projects</div>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="truncate rounded-lg px-2.5 py-1.5">Plumbers · Austin</div>
              <div className="truncate rounded-lg px-2.5 py-1.5">Dentists · Miami</div>
            </div>
            <div className="mt-auto flex items-center gap-2 pt-4">
              <Image src={FACES[1]} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-xs font-semibold text-foreground">Alex Carter</div>
                <div className="text-[10px] text-muted-foreground">Growth plan</div>
              </div>
            </div>
          </aside>

          {/* main */}
          <div className="min-w-0 flex-1 p-5">
            <div className="flex items-center justify-between">
              <div className="font-heading text-base font-bold">Find leads</div>
              <span className="hidden items-center gap-1.5 rounded-full bg-flare/20 px-2.5 py-1 text-[11px] font-semibold text-flare-ink sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[#e0a412]" /> 6 jobs included
              </span>
            </div>
            {/* search bar */}
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-sm">
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 truncate text-sm text-foreground">plumbers in Austin, TX</span>
              <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Scrape</span>
            </div>
            {/* leads list */}
            <div className="mt-4 space-y-2">
              {SCRAPE_FEED.map((r) => (
                <div key={r.n} className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2.5 text-xs shadow-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{r.n}</div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Phone className="h-3 w-3" /> {r.m}</div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <span className="flex items-center gap-0.5 text-flare"><Star className="h-3 w-3 fill-current" />{r.r}</span>
                    {r.bad
                      ? <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600">No site</span>
                      : <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Live</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- bento widgets -- */

function Sparkline() {
  return (
    <svg viewBox="0 0 120 36" className="h-9 w-28">
      <path d="M0,30 L14,22 L26,26 L40,12 L54,18 L68,8 L82,16 L96,5 L120,2" fill="none" stroke="#e0a412" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------- step mockups -- */

function StepMock({ step }) {
  if (step === 0) {
    return (
      <div className="p-6">
        <div className="text-sm font-semibold text-muted-foreground">Quick builder</div>
        <div className="mt-3 text-xs font-semibold text-foreground">Niche</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {["Plumbers", "Dentists", "Roofers", "HVAC", "Salons"].map((s, i) => (
            <span key={s} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${i === 0 ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground"}`}>{s}</span>
          ))}
        </div>
        <div className="mt-4 text-xs font-semibold text-foreground">City</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {["Austin, TX", "Miami, FL", "Denver, CO", "Phoenix, AZ"].map((s, i) => (
            <span key={s} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${i === 0 ? "bg-flare/25 text-flare-ink" : "border border-border bg-card text-muted-foreground"}`}>{s}</span>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-foreground">plumbers in Austin, TX</span>
          <span className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Start</span>
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" /></span>
            Scraping · Austin TX
          </span>
          <span className="text-sm font-bold text-foreground">1,284</span>
        </div>
        <div className="mt-4 space-y-3">
          {[{ l: "Businesses found", p: "100%", v: "1,284" }, { l: "Emails enriched", p: "71%", v: "912" }, { l: "WhatsApp detected", p: "27%", v: "347" }].map((b) => (
            <div key={b.l}>
              <div className="flex justify-between text-xs text-muted-foreground"><span>{b.l}</span><span className="font-semibold text-foreground">{b.v}</span></div>
              <div className="mt-1 h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-gradient-to-r from-primary to-flare" style={{ width: b.p }} /></div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <Mail className="h-3.5 w-3.5 text-primary" /> office@example.com
          <MessageCircle className="ml-auto h-3.5 w-3.5 text-emerald-600" />
        </div>
      </div>
    );
  }
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div className="font-heading text-sm font-bold">Pipeline</div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-flare/25 px-2.5 py-1 text-xs font-semibold text-flare-ink"><FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV</span>
      </div>
      <div className="mt-4 space-y-2">
        {[{ n: "Northwind HVAC", s: "Contacted", c: "bg-amber-500/10 text-amber-700" }, { n: "Fabrikam Electric", s: "Replied", c: "bg-emerald-500/10 text-emerald-600" }, { n: "Contoso Roofing", s: "To call", c: "bg-amber-500/10 text-amber-600" }, { n: "Acme Plumbing Co.", s: "Won", c: "bg-flare/30 text-flare-ink" }].map((r) => (
          <div key={r.n} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="truncate font-medium text-foreground">{r.n}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.c}`}>{r.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- pricing -- */

function PriceCard({ plan, signedIn }) {
  const Icon = PLAN_ICONS[plan.id];
  const blue = plan.style === "blue";
  const dark = plan.style === "dark";

  const shell = blue
    ? "border-transparent bg-gradient-to-b from-[#05604a] to-primary text-white shadow-2xl shadow-primary/30"
    : dark
      ? "border-transparent bg-[#0a0e1a] text-white"
      : "border-border bg-card";
  const sub = blue ? "text-white/75" : dark ? "text-white/60" : "text-muted-foreground";
  const tile = blue ? "bg-white/15 text-white" : dark ? "bg-white/10 text-white" : "bg-primary/10 text-primary";
  const per = blue ? "text-white/75" : dark ? "text-white/60" : "text-muted-foreground";
  const rule = blue || dark ? "bg-white/15" : "bg-border";
  const checkWrap = blue ? "bg-white/20 text-white" : dark ? "bg-white/10 text-flare" : "bg-flare/30 text-flare-ink";
  const perkText = blue ? "text-white/90" : dark ? "text-white/70" : "text-muted-foreground";

  const btnClass = blue ? "lf-cta bg-white text-primary hover:bg-white/90"
    : dark ? "lf-cta bg-white text-slate-900 hover:bg-white/90" : "";
  const btnVariant = blue || dark ? "default" : "outline";

  return (
    <div className={`relative flex h-full flex-col rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1.5 ${shell} ${blue ? "lg:-mt-4 lg:mb-4" : ""}`}>
      {plan.popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-flare px-3 py-1 text-xs font-semibold text-flare-ink shadow-lg">Most popular</span>
      )}
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${tile}`}><Icon className="h-5 w-5" /></div>
      <div className="font-heading text-lg font-bold">{plan.name}</div>
      <div className={`mt-1 text-sm ${sub}`}>{plan.sub}</div>
      <div className={`my-5 h-px ${rule}`} />
      <div className="flex items-end gap-1">
        <span className="font-heading text-4xl font-bold tracking-tight">${plan.price}</span>
        <span className={`mb-1 text-sm ${per}`}>/ month</span>
      </div>
      <div className={`mt-1 text-xs ${per}`}>{plan.quota}</div>

      <Cta signedIn={signedIn} callbackUrl={plan.callbackUrl} className={`mt-6 w-full rounded-xl ${btnClass}`} variant={btnVariant}>
        {plan.cta}
      </Cta>

      <div className={`mb-3 mt-6 text-xs font-semibold uppercase tracking-wider ${per}`}>Added features</div>
      <ul className="space-y-3 text-sm">
        {plan.perks.map((p) => (
          <li key={p} className="flex items-start gap-2.5">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${checkWrap}`}><Check className="h-3 w-3" /></span>
            <span className={perkText}>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------- discover scroll deck -- */

// Cards pin (sticky) and, as the next card scrolls up to cover it, the one
// behind smoothly scales down + dims, so the deck animates as you scroll rather
// than snapping. Driven by scroll via rAF on refs (no per-frame re-render).
// Tilts the cards right/left/right/left, and honors reduced-motion.
function DiscoverCards() {
  const wrapRef = useRef(null);
  const cardRefs = useRef([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const cards = cardRefs.current.filter(Boolean);
      const desktop = window.innerWidth >= 1024;
      if (!desktop || reduce) {
        cards.forEach((el, i) => {
          el.style.transform = `rotate(${i % 2 === 0 ? 2.2 : -2.2}deg)`;
          el.style.opacity = "1";
        });
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const progress = clamp(-rect.top / total, 0, 1);
      const active = progress * cards.length;
      cards.forEach((el, i) => {
        const stickyTop = 100 + i * 16;
        const currentTop = el.getBoundingClientRect().top;
        
        // Progress of the card scrolling into its sticky position (0 = below viewport, 1 = pinned)
        const progressToSticky = clamp((window.innerHeight - currentTop) / (window.innerHeight - stickyTop), 0, 1);
        
        const finalTilt = i % 2 === 0 ? 2.2 : -2.2;
        const initialTilt = -finalTilt * 2.5; // opposite tilt direction
        const tilt = initialTilt + (finalTilt - initialTilt) * progressToSticky;
        
        const translateY = (1 - progressToSticky) * 40; // slide up 40px as it enters
        const depth = clamp(active - i - 0.6, 0, 3); // how far behind the front card
        
        // No scale() here on purpose. A fractional scale lands glyphs on
        // non-integer pixels, and combined with the promoted layer below it was
        // what made this card's body text look blurry. Depth reads from the
        // opacity and the stack offset on their own.
        el.style.transform = `translateY(${translateY}px) rotate(${tilt}deg)`;
        el.style.opacity = String(1 - depth * 0.06);
      });
    };

    // will-change promotes each card to its own GPU layer, and a promoted layer
    // is rasterised once and then re-used by the compositor - so rotated text
    // gets resampled instead of redrawn, permanently. Promote only while a
    // scroll is actually in flight, then hand the cards back to the renderer so
    // they are drawn sharp at rest, which is when they are being read.
    let settle = 0;
    const onScroll = () => {
      const cards = cardRefs.current.filter(Boolean);
      for (const el of cards) el.style.willChange = "transform";
      clearTimeout(settle);
      settle = setTimeout(() => {
        for (const el of cardRefs.current.filter(Boolean)) el.style.willChange = "auto";
      }, 120);
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      clearTimeout(settle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className="space-y-5 lg:space-y-12">
      {DISCOVER.map((d, i) => (
        <div key={d.title} className="lg:sticky" style={{ top: `${100 + i * 16}px` }}>
          <div
            ref={(el) => (cardRefs.current[i] = el)}
            style={{ transformOrigin: "center top", transform: `rotate(${i % 2 === 0 ? "2.2deg" : "-2.2deg"})` }}
            className={`relative min-h-[180px] overflow-hidden rounded-3xl border border-border bg-card bg-gradient-to-br ${d.grad} p-7 ring-1 ${d.ring} shadow-xl shadow-black/[0.07]`}
          >
            <span className={`absolute right-5 top-5 h-2.5 w-2.5 rounded-full ${d.dot} shadow-[0_0_0_4px_rgba(255,255,255,0.6)]`} />
            <div className={`mb-4 inline-flex items-center gap-2 rounded-2xl px-3 py-2 ${d.chip}`}>
              <d.icon className="h-5 w-5" />
              <span className="text-[11px] font-bold uppercase tracking-wide">{d.tag}</span>
            </div>
            <h3 className="font-heading text-xl font-bold text-foreground">{d.title}</h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-foreground/85">{d.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- page -- */

export default function Landing({ recent = [], total = 0 }) {
  const [step, setStep] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  // Asked once, here, and threaded down - every CTA on the page needs the same
  // answer and three components polling /api/public/me would be three requests
  // for one fact.
  const { signedIn, label: me } = useSignedIn();

  return (
    <div className="lf relative min-h-screen overflow-x-clip bg-background text-foreground">
      {/* ambient colourful blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute -right-48 top-40 h-[30rem] w-[30rem] rounded-full bg-flare-tint/60 blur-3xl" />
        <div className="absolute left-1/3 top-[48rem] h-[26rem] w-[26rem] rounded-full bg-flare/12 blur-3xl" />
      </div>

      {/* ---- nav ---- */}
      <header className="sticky top-3 z-40 px-4">
        <div className="container relative">
          <div className="flex h-16 items-center justify-between rounded-[1.75rem] border border-border/50 bg-card/95 px-3 pl-6 shadow-[0_4px_24px_-8px_rgba(1,59,47,0.14)] backdrop-blur-xl sm:h-[4.5rem]">
            <Logo />
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 text-[0.95rem] font-medium md:flex">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="rounded-full px-3.5 py-1.5 text-foreground/70 transition-colors hover:bg-muted hover:text-foreground">{n.label}</a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <Cta signedIn={signedIn} className="hidden h-11 rounded-xl px-5 text-[0.95rem] font-semibold sm:inline-flex" signedInLabel="Dashboard">Get started</Cta>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground md:hidden hover:bg-muted transition-colors"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Mobile nav dropdown */}
          {mobileMenuOpen && (
            <div className="absolute left-0 right-0 top-16 z-50 rounded-2xl border border-border/75 bg-background/95 p-4 shadow-xl backdrop-blur-xl md:hidden animate-in fade-in slide-in-from-top-5 duration-200">
              <nav className="flex flex-col gap-1.5">
                {NAV.map((n) => (
                  <a
                    key={n.href}
                    href={n.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {n.label}
                  </a>
                ))}
                <div className="mt-2 border-t border-border/60 pt-3">
                  <Cta signedIn={signedIn} size="lg" className="w-full rounded-xl" signedInLabel="Dashboard">Get started</Cta>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* ---- hero ---- */}
      {/*
        Headline, sub and a single call to action, with the product collage
        (HeroApp) carrying the "what it looks like" job directly underneath.
        The inline search box that used to sit here was removed on request.
      */}
      <section className="relative px-4">
        <HeroDecor />
        <div className="container relative z-10 flex flex-col items-center pb-10 pt-10 text-center sm:pt-14">
          <span className="mb-5 inline-flex max-w-full items-center gap-2 rounded-lg bg-muted px-4 py-2 text-center text-sm font-medium text-foreground/75">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            Live local search, results in seconds
          </span>
          {/* Two lines, always: the break is authored rather than left to the
              container, because "in any city" is the half that carries the
              colour and the underline and it has to stay whole. */}
          <h1 className="font-heading max-w-[19ch] text-[2.4rem] font-bold leading-[1.08] tracking-[-0.022em] sm:text-[3.2rem] xl:text-[3.85rem]">
            Find your next customers{" "}
            <span className="relative inline-block whitespace-nowrap text-primary">
              in any city
              <Swoosh className="absolute -bottom-2.5 right-0 h-[0.7rem] w-[41%]" />
            </span>
          </h1>
          <p className="mt-6 max-w-[34.5rem] text-[1.075rem] leading-[1.7] text-muted-foreground">
            Pick a niche and a city. You get the businesses, their ratings and
            contact details, including emails, socials and WhatsApp, as one list you can export.
          </p>

          {/* The hero needs one action now that the inline search box is gone. */}
          <div className="mt-8">
            <Cta signedIn={signedIn} size="lg" className="lf-cta rounded-xl px-7" signedInLabel="Open dashboard">Continue with Google</Cta>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <AvatarStack />
            <span className="text-sm text-muted-foreground">Trusted by <span className="font-semibold text-foreground">2,400+</span> marketers</span>
            <span className="flex items-center gap-2"><Stars className="h-4 w-4" /> <span className="text-sm font-semibold text-foreground">5.0</span></span>
          </div>
        </div>

        <HeroApp />
      </section>

      {/* ---- about ---- */}
      <section id="about" className="container py-24">
        <Reveal className="mx-auto max-w-3xl text-center">
          <Eyebrow icon={Users}>Why LeadsFunda</Eyebrow>
          <p className="font-heading mx-auto mt-6 max-w-2xl text-2xl font-bold leading-snug tracking-tight sm:text-[2rem]">
            Everything you need to find and reach local leads in one tab.
          </p>
        </Reveal>
        
        {/* Simple & precise features grid with short info cards */}
        <Reveal delay={120} className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PILLS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="group flex flex-col items-center text-center rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-all duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="font-heading text-base font-bold text-foreground">
                  {item.label}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            );
          })}
        </Reveal>
      </section>

      {/* ---- discover: sticky-left + pastel card stack ---- */}
      <section className="border-y border-border/60 bg-muted/20 py-24">
        <div className="container grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div className="lg:sticky lg:top-28 lg:h-fit lg:self-start">
            <Eyebrow icon={MapPin}>The lead journey</Eyebrow>
            <h2 className="font-heading mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]">Follow one lead from search to sent</h2>
            <p className="mt-4 max-w-md text-muted-foreground">A map listing is a name and a pin. Here is exactly what LeadsFunda does to it before it reaches you, stage by stage, and what each stage costs in credits.</p>
            <div className="mt-7 hidden lg:block">
              <Cta signedIn={signedIn} size="lg" className="lf-cta rounded-xl px-7" signedInLabel="Open dashboard">Continue with Google</Cta>
            </div>
          </div>
          <DiscoverCards />
        </div>
      </section>

      {/* ---- bento: everything in one tab ---- */}
      <RecentSearches items={recent} total={total} me={me} />

      <section id="features" className="container py-24">
        <Reveal><SectionHead icon={Sparkles} eyebrow="Features" title="Everything in one tab"
          sub="Scrape, enrich, audit and organize. The whole outreach workflow, with no stitching tools together." className="mb-12" /></Reveal>
        <div className="grid grid-cols-1 auto-rows-fr gap-5 lg:grid-cols-6">
          {/* row 1: three equal cells */}
          <Reveal className="lg:col-span-2"><BentoCell icon={MapPin} tile="bg-primary/10 text-primary" title="Scrape the map" body="Name, phone, website, rating, reviews and hours for any niche + city.">
            <div className="space-y-2">
              {SCRAPE_FEED.slice(0, 3).map((r) => (
                <div key={r.n} className="flex items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-1.5 text-[11px] shadow-sm">
                  <Building2 className="h-3.5 w-3.5 text-primary" /><span className="truncate font-medium text-foreground">{r.n}</span>
                  <span className="ml-auto text-muted-foreground">{r.m}</span>
                </div>
              ))}
            </div>
          </BentoCell></Reveal>

          <Reveal delay={90} className="lg:col-span-2"><BentoCell icon={Mail} tile="bg-primary/10 text-primary" title="Enrich every contact" body="Emails, socials and WhatsApp crawled from each business's own website.">
            <div className="flex flex-wrap gap-2">
              {[{ t: "Email", c: "bg-primary/10 text-primary" }, { t: "WhatsApp", c: "bg-emerald-500/10 text-emerald-600" }, { t: "Instagram", c: "bg-rose-500/10 text-rose-600" }, { t: "Facebook", c: "bg-primary/10 text-primary" }, { t: "LinkedIn", c: "bg-sky-500/10 text-sky-600" }].map((s) => (
                <span key={s.t} className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${s.c}`}>{s.t}</span>
              ))}
            </div>
          </BentoCell></Reveal>

          <Reveal delay={180} className="lg:col-span-2"><BentoCell icon={Search} tile="bg-amber-500/10 text-amber-600" title="Find leads in seconds" body="Type a niche or pick from 190+ presets, choose a city, and go.">
            <div className="rounded-xl border border-border bg-background">
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground"><Search className="h-3.5 w-3.5" /> Ask for a niche…</div>
              {["Plumbers", "Dentists", "Roofers"].map((s, i) => (
                <div key={s} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${i === 0 ? "bg-muted/60 font-semibold text-foreground" : "text-muted-foreground"}`}><Wand2 className="h-3.5 w-3.5 text-amber-600" /> {s}</div>
              ))}
            </div>
          </BentoCell></Reveal>

          {/* row 2: two wide cells */}
          <Reveal delay={120} className="lg:col-span-2"><BentoCell icon={Zap} tile="bg-flare-tint text-flare-ink" title="Instant delivery" body="Leads arrive in seconds from our pre-built database. No scraping delays, no browser needed.">
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-3">
              <div><div className="text-[11px] text-muted-foreground">Avg. delivery</div><div className="font-heading text-lg font-bold text-foreground">&lt; 5s</div></div>
              <Sparkline />
            </div>
          </BentoCell></Reveal>

          <Reveal delay={210} className="lg:col-span-4"><BentoCell icon={Activity} tile="bg-emerald-500/10 text-emerald-600" title="Actionable insights" body="See what's landing in real time and pounce on the warmest prospects first.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-3">
                <div><div className="text-[11px] text-muted-foreground">Leads today</div><div className="font-heading text-xl font-bold text-foreground">1,860 <span className="text-xs font-semibold text-emerald-600">+10%</span></div></div>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-flare/25 text-flare-ink"><TrendingUp className="h-4 w-4" /></span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bell className="h-4 w-4" /></span>
                <div className="leading-tight"><div className="text-xs font-semibold text-foreground">New lead captured</div><div className="text-[11px] text-muted-foreground">+1 to Plumbers · Austin</div></div>
              </div>
            </div>
          </BentoCell></Reveal>
        </div>

        {/* The exit - where a finished list actually goes. Deliberately outside
            the grid above: auto-rows-fr would stretch a lone full-width cell to
            match the tallest row and leave half of it empty. */}
        <div className="mt-5">
          <Reveal delay={150}><BentoCell icon={Share2} tile="bg-emerald-500/10 text-emerald-600" title="Send them to your CRM"
            body="One click from your list into Smartlead, Instantly, HubSpot or Pipedrive. Push the same list twice and nothing duplicates.">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { t: "Smartlead", s: "412 added", c: "text-emerald-600" },
                { t: "HubSpot", s: "88 updated", c: "text-orange-600" },
                { t: "Instantly", s: "1,204 added", c: "text-violet-600" },
              ].map((r) => (
                <div key={r.t} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-[11px] shadow-sm">
                  <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${r.c}`} />
                  <span className="font-semibold text-foreground">{r.t}</span>
                  <span className="ml-auto text-muted-foreground">{r.s}</span>
                </div>
              ))}
            </div>
          </BentoCell></Reveal>
        </div>
      </section>

      {/* ---- integrations: the "works with" band ---- */}
      <section id="integrations" className="border-y border-border/60 bg-muted/20 py-20">
        <div className="container">
          <Reveal><SectionHead icon={Plug} eyebrow="Integrations" title="Works with the tools you already send from"
            sub="Connect once with an API key, then push leads across whenever you like. Webhooks cover Zapier, Make and n8n, which reach almost everything else."
            className="mb-10" /></Reveal>
          <Reveal delay={90}>
            <ul className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3">
              {INTEGRATIONS.map((i) => (
                <li key={i.name}
                    className={`flex items-baseline gap-2 rounded-xl bg-background px-4 py-3 shadow-sm ring-1 ${i.ring}`}>
                  <span className={`font-heading text-lg font-bold tracking-tight ${i.tint}`}>{i.name}</span>
                  <span className="text-[11px] font-medium text-muted-foreground">{i.note}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={180}>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Already there? Re-pushing a list updates those leads instead of duplicating them.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---- stats band ---- */}
      <section className="border-y border-border/60 py-16">
        <div className="container grid grid-cols-2 gap-8 md:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.l} delay={i * 90}>
              <div className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{s.v}</div>
              <div className="mt-2 text-sm text-muted-foreground">{s.l}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- how it works: stepper + dynamic mock ---- */}
      <section id="how" className="container py-24">
        <Reveal><SectionHead icon={ListChecks} eyebrow="How to use" title="Designed for simplicity"
          sub="Three steps from a niche to a full, enriched pipeline." className="mb-12" /></Reveal>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div className="space-y-3">
            {STEPS.map((s, i) => {
              const active = step === i;
              return (
                <button key={s.n} onClick={() => setStep(i)} className={`group relative flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition-all ${active ? "border-border bg-card shadow-xl shadow-primary/5" : "border-transparent hover:bg-card/60"}`}>
                  {active && <span className="absolute inset-x-5 top-0 h-1 rounded-full bg-gradient-to-r from-primary to-flare" />}
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><s.icon className="h-5 w-5" /></span>
                  <span>
                    <span className="font-heading flex items-center gap-2 text-lg font-bold">{s.title}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{s.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Reveal className="overflow-hidden rounded-3xl border border-border bg-muted/30 shadow-xl shadow-primary/5">
            <div className="flex items-center gap-2 border-b border-border/60 bg-card px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="ml-2 text-xs text-muted-foreground">Step {step + 1} of 3</span>
            </div>
            <div className="bg-card"><StepMock step={step} /></div>
          </Reveal>
        </div>
      </section>

      {/* ---- testimonials ---- */}
      <section id="reviews" className="border-y border-border/60 bg-muted/20 py-24">
        <div className="container">
          <Reveal><SectionHead icon={Star} eyebrow="Testimonials" title="What our users are saying"
            sub="Real feedback from people who run outreach every day." className="mb-12" /></Reveal>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={(i % 3) * 90}>
                <div className="h-full rounded-3xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Image src={t.img} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{t.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.handle}</div>
                    </div>
                    <Stars className="ml-auto h-3 w-3" />
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-foreground/80">{t.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- pricing ---- */}
      <section id="pricing" className="container py-24">
        <Reveal><SectionHead icon={Zap} eyebrow="Pricing" title="Simple plans for every stage"
          sub="Choose a plan that fits your needs, budget and growth." className="mb-10" /></Reveal>
        <div className="rounded-[2rem] border border-border bg-muted/30 p-5 sm:p-8 pt-10 sm:pt-14">
          <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-4">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 80} className="h-full flex flex-col"><PriceCard plan={plan} signedIn={signedIn} /></Reveal>
            ))}
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">Sign in with Google, then subscribe. Payments processed securely by Whop. Cancel anytime.</p>
      </section>

      {/* ---- faq (static grid, like the template) ---- */}
      <section id="faq" className="border-t border-border/60 bg-muted/20 py-24">
        <div className="container">
          <Reveal><SectionHead icon={MessageCircle} eyebrow="FAQs" title="Explore our FAQs"
            sub="Quick answers to the questions we hear most. Still stuck? Reach out any time." className="mb-14" /></Reveal>
          <div className="mx-auto max-w-3xl space-y-4">
            {FAQ.map((item, i) => {
              const isOpen = openFaqIndex === i;
              return (
                <Reveal key={item.q} delay={i * 60}>
                  <div className="overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:border-primary/30">
                    <button
                      onClick={() => setOpenFaqIndex(isOpen ? null : i)}
                      className="flex w-full items-center justify-between p-5 text-left font-heading text-base font-bold text-foreground transition-colors hover:text-primary"
                    >
                      <span>{item.q}</span>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-300 shrink-0 ${isOpen ? "rotate-180 text-primary" : ""}`} />
                    </button>
                    <div
                      className={`transition-all duration-300 ease-in-out ${isOpen ? "max-h-[440px] border-t border-border/50 opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}
                    >
                      <div className="p-5 text-sm leading-relaxed text-muted-foreground bg-muted/10">
                        {item.a}
                      </div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- cta banner ---- */}
      <section className="container py-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary via-[#04503f] to-[#046a50] px-6 py-16 text-center text-white">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-flare/15 blur-3xl" />
          <h2 className="font-heading mx-auto max-w-xl text-3xl font-bold sm:text-4xl">Ready to build your lead list?</h2>
          <p className="mx-auto mt-3 max-w-lg text-white/80">Sign in with Google and run your first scrape in minutes.</p>
          <div className="mt-7 flex justify-center">
            <Cta signedIn={signedIn} size="lg" variant="secondary" className="lf-cta rounded-xl px-7" signedInLabel="Open dashboard">Continue with Google</Cta>
          </div>
        </div>
      </section>
      {/* ---- footer ---- */}
      <footer className="px-4 pb-6">
        <div className={`container overflow-hidden bg-transparent md:bg-card border-none md:border md:rounded-[2rem] md:shadow-sm ${HATCH}`}>
          <div className="grid grid-cols-2 gap-8 p-6 md:p-10 md:grid-cols-5">
            <div className="col-span-2 md:col-span-2">
              <Logo />
              <p className="mt-4 max-w-xs text-sm text-muted-foreground">Turn public map listings into a pipeline of enriched, ready-to-pitch B2B leads with 99% email data accuracy.</p>
            </div>
            <div>
              <div className="mb-4 text-sm font-semibold text-foreground">Pages</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {NAV.map((n) => <li key={n.href}><a href={n.href} className="transition-colors hover:text-foreground">{n.label}</a></li>)}
              </ul>
            </div>
            <div>
              <div className="mb-4 text-sm font-semibold text-foreground">Legal</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="/terms" className="transition-colors hover:text-foreground">Terms of Service</a></li>
                <li><a href="/privacy" className="transition-colors hover:text-foreground">Privacy Policy</a></li>
                <li><a href="/can-spam" className="transition-colors hover:text-foreground">CAN-SPAM Policy</a></li>
              </ul>
            </div>
            <div>
              <div className="mb-4 text-sm font-semibold text-foreground">Support</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="/contact" className="transition-colors hover:text-foreground">Contact Us</a></li>
                <li><a href="mailto:support@leadsfunda.com" className="transition-colors hover:text-foreground">Email Support</a></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-1">
              <div className="mb-4 text-sm font-semibold text-foreground">Social</div>
              <div className="flex items-center gap-2.5">
                <a href="https://x.com/leadsfunda" target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#000000] text-white shadow-sm transition-all hover:opacity-80 hover:scale-110">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>
                </a>
                <a href="https://instagram.com/leadsfunda" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm transition-all hover:opacity-80 hover:scale-110" style={{ background: "linear-gradient(45deg, #F58529, #DD2A7B 45%, #8134AF 70%, #515BD4)" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" /></svg>
                </a>
                <a href="https://facebook.com/leadsfunda" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1877F2] text-white shadow-sm transition-all hover:opacity-80 hover:scale-110">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" /></svg>
                </a>
                <a href="#" aria-label="LinkedIn" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0A66C2] text-white shadow-sm transition-all hover:opacity-80 hover:scale-110">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" /></svg>
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-2 border-t border-border px-6 md:px-10 py-5 text-sm text-muted-foreground sm:flex-row">
            <span>© {new Date().getFullYear()} LeadsFunda. All rights reserved.</span>
            <span>Built for people who actually outreach.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// One bento cell: icon tile + title + body + a custom mini-widget.
function BentoCell({ icon: Icon, tile, title, body, children }) {
  return (
    <div className="group flex h-full flex-col rounded-3xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10">
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${tile} transition-transform duration-300 group-hover:scale-110`}><Icon className="h-5 w-5" /></div>
      <h3 className="font-heading text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}
