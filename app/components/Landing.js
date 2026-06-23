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
  Play,
  ArrowRight,
  Zap,
  Sparkles,
  Building2,

  ShieldCheck,
  Gauge,
  Filter,
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
} from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button } from "./ui/button";

// Faint diagonal hatch the template uses behind several light sections.
const HATCH =
  "[background-image:repeating-linear-gradient(45deg,hsl(var(--foreground)/0.022)_0,hsl(var(--foreground)/0.022)_1px,transparent_1px,transparent_11px)]";

/* ------------------------------------------------------------------ data -- */

const NAV = [
  { href: "#about", label: "About" },
  { href: "#features", label: "Features" },
  { href: "#reviews", label: "Reviews" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

// Quiet, uniform "About" tag-pills (one subtle style, brand dot only).
const PILLS = [
  { label: "Verified emails", dot: "bg-violet-400" },
  { label: "WhatsApp numbers", dot: "bg-emerald-400" },
  { label: "Website health", dot: "bg-sky-400" },
  { label: "Owner contacts", dot: "bg-blue-400" },
  { label: "Social profiles", dot: "bg-rose-400" },
  { label: "Ratings & reviews", dot: "bg-amber-400" },
  { label: "Phone numbers", dot: "bg-cyan-400" },
  { label: "Clean CSV export", dot: "bg-orange-400" },
];

// Sticky-left "Discover" pastel card stack.
const DISCOVER = [
  { icon: Filter, title: "Smart filters", body: "Slice any niche by rating, reviews and website status so you only work the leads worth your time.", grad: "from-emerald-50 to-emerald-100/40", ring: "ring-emerald-200/70", dot: "bg-emerald-400", chip: "bg-emerald-500/10 text-emerald-600" },
  { icon: Mail, title: "Contact enrichment", body: "Emails, socials and WhatsApp pulled from each business's own site, so your list is sendable on arrival.", grad: "from-violet-50 to-violet-100/40", ring: "ring-violet-200/70", dot: "bg-violet-400", chip: "bg-violet-500/10 text-violet-600" },
  { icon: Gauge, title: "Website health", body: "Real-Chrome audits flag broken, slow or missing sites so the warmest pitches rise to the top.", grad: "from-sky-50 to-sky-100/40", ring: "ring-sky-200/70", dot: "bg-sky-400", chip: "bg-sky-500/10 text-sky-600" },
  { icon: Zap, title: "Instant results", body: "Leads delivered in seconds from our database of millions of verified businesses — no waiting, no browser needed.", grad: "from-orange-50 to-orange-100/40", ring: "ring-orange-200/70", dot: "bg-orange-400", chip: "bg-orange-500/10 text-orange-600" },
  { icon: Database, title: "One clean export", body: "Every field deduped and normalised, exported to a tidy CSV that drops straight into your CRM.", grad: "from-rose-50 to-rose-100/40", ring: "ring-rose-200/70", dot: "bg-rose-400", chip: "bg-rose-500/10 text-rose-600" },
];

const STATS = [
  { v: "2.4M+", l: "Leads scraped" },
  { v: "190+", l: "Niches covered" },
  { v: "9", l: "Socials per lead" },
  { v: "< 5s", l: "Average delivery" },
];

const STEPS = [
  { n: "01", icon: Search, title: "Pick a niche & city", body: "Choose a service and location, or paste your own Maps query, then set how many leads you want." },
  { n: "02", icon: Zap, title: "We scrape & enrich", body: "We pull every business, then crawl their sites for emails, socials and WhatsApp, automatically." },
  { n: "03", icon: ListChecks, title: "Work the pipeline", body: "Filter, audit websites, mark outreach status and export a clean CSV ready for your campaigns." },
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
  { id: "free", name: "Free", price: 0, sub: "Kick the tires, no card", quota: "Free starter credits",
    perks: ["Free starter credits", "Find + preview leads", "Basic enrichment", "CSV export"],
    cta: "Start free", callbackUrl: "/dashboard", style: "light" },
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

const FAQ = [
  { q: "Do I need to install anything?", a: "No. LeadsFunda runs entirely in the cloud. Sign in with Google, start a scrape, and your leads appear in the dashboard, even if you close the tab." },
  { q: "Where do the leads come from?", a: "Public Google Maps business listings for the niche and location you choose. We then visit each business's own website to enrich emails and social profiles." },
  { q: "Can I cancel anytime?", a: "Yes. Plans are monthly and managed through Whop. Upgrade, downgrade or cancel whenever you like, with no contracts." },
  { q: "What counts as a credit?", a: "Finding a lead costs 1 credit; a quick audit 3, a chatbot scan 5, and a full website report 10. Re-checking a lead you already own is free." },
  { q: "Is my data safe?", a: "Every account's leads and projects are fully isolated and protected. We never share or resell your data." },
  { q: "How fast is a scrape?", a: "Jobs run on our servers with up to six in parallel, so a few thousand leads typically finish while you grab a coffee." },
];

// Mock data for the product-window collage.
const SCRAPE_FEED = [
  { n: "Lone Star Plumbing", m: "(512) 555-0182", r: "4.8", bad: true },
  { n: "Hill Country HVAC", m: "(512) 555-0143", r: "4.6", bad: false },
  { n: "Capital Roofing Co.", m: "(512) 555-0117", r: "4.9", bad: true },
  { n: "Barton Electric", m: "(512) 555-0164", r: "4.4", bad: false },
];
const ENRICH_FEED = [
  { name: "Hill Country HVAC", e: "office@hillcountryhvac.com", wa: true },
  { name: "Barton Electric", e: "team@bartonelectric.com", wa: true },
  { name: "Capital Roofing", e: "hello@capitalroofing.co", wa: false },
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

// Small pill eyebrow with icon, used above every section heading.
function Eyebrow({ icon: Icon = Sparkles, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground/70 shadow-sm">
      <Icon className="h-3.5 w-3.5 text-primary" /> {children}
    </span>
  );
}

function Stars({ className = "h-3.5 w-3.5" }) {
  return (
    <div className="flex items-center gap-0.5 text-amber-400">
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} className={`${className} fill-current`} />)}
    </div>
  );
}

function AvatarStack() {
  return (
    <div className="flex -space-x-2.5">
      {FACES.slice(0, 3).map((src) => (
        <Image key={src} src={src} alt="" width={32} height={32} className="h-8 w-8 rounded-full border-2 border-background object-cover shadow-sm" />
      ))}
    </div>
  );
}

// Official LeadsFunda wordmark (blue + dark ink, made for light backgrounds).
// viewBox is 683.78 x 132.24, so width = height * 5.17.
function Logo({ height = 28, className = "" }) {
  return (
    <Image
      src="/brand/leadsfunda-white.svg"
      alt="LeadsFunda"
      width={145}
      height={28}
      priority
      className={`h-[20px] w-auto sm:h-[28px] sm:w-auto ${className}`}
    />
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
      className={`animate-float absolute z-20 hidden rounded-2xl border border-border bg-card/95 p-4 shadow-2xl shadow-black/10 backdrop-blur-md lg:block ${className}`}
    >
      {children}
    </div>
  );
}

function HeroApp() {
  return (
    <div className="container relative max-w-5xl pb-8">
      {/* lime glow under the window */}
      <div className="pointer-events-none absolute -inset-x-10 -bottom-10 top-10 -z-10 rounded-[3rem] bg-gradient-to-tr from-primary/20 via-violet-400/15 to-[#a2e435]/30 blur-3xl" />

      {/* floating overlap cards */}
      <FloatCard className="-left-10 top-28 w-60" delay={0}>
        <div className="text-xs font-semibold text-muted-foreground">Credits this month</div>
        <div className="mt-3 space-y-3">
          {[{ l: "Searches", p: "62%", c: "bg-primary" }, { l: "Leads", p: "48%", c: "bg-[#7cc20a]" }].map((b) => (
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
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600"><Building2 className="h-4 w-4" /></span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">Capital Roofing Co.</div>
            <div className="text-[11px] text-muted-foreground">Austin, TX · ★ 4.9</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <Mail className="h-3.5 w-3.5 text-violet-600" /><span className="truncate text-foreground">hello@capitalroofing.co</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[{ t: "No SSL", c: "bg-rose-500/10 text-rose-600" }, { t: "Slow site", c: "bg-amber-500/10 text-amber-600" }, { t: "No chatbot", c: "bg-violet-500/10 text-violet-600" }].map((tag) => (
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
            <Logo height={18} />
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
              <span className="hidden items-center gap-1.5 rounded-full bg-[#a2e435]/20 px-2.5 py-1 text-[11px] font-semibold text-[#3a6b00] sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7cc20a]" /> 6 jobs free
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
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"><Building2 className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{r.n}</div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Phone className="h-3 w-3" /> {r.m}</div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <span className="flex items-center gap-0.5 text-amber-500"><Star className="h-3 w-3 fill-current" />{r.r}</span>
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

/* ------------------------------------------------------ research widgets -- */

// Wavy trend line + highlighted point with a value tooltip.
function TrendChart() {
  return (
    <div className="mt-5 rounded-2xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <span className="font-heading text-sm font-bold">Lead value</span>
        <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">Last 7 days <ChevronDown className="h-3 w-3" /></span>
      </div>
      <div className="relative mt-4">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-card px-2.5 py-1 text-center shadow-md ring-1 ring-border">
          <div className="text-sm font-bold text-foreground">$4,100</div>
          <div className="text-[10px] text-muted-foreground">from 28 closes</div>
        </div>
        <svg viewBox="0 0 320 150" className="mt-9 h-28 w-full overflow-visible">
          {[30, 70, 110].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 5" />)}
          <path d="M0,96 C24,78 44,70 64,84 C88,100 104,52 128,58 C150,64 158,108 182,96 C206,84 214,40 240,52 C266,64 286,30 320,22" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" />
          <circle cx="160" cy="86" r="9" fill="hsl(var(--primary)/0.2)" />
          <circle cx="160" cy="86" r="4.5" fill="hsl(var(--primary))" />
        </svg>
      </div>
    </div>
  );
}

// Owner-contact chat bubbles with floating collaboration cursor tags.
function EnrichChat() {
  return (
    <div className="relative mt-5 h-60 rounded-2xl border border-border bg-background p-4">
      <div className="space-y-3">
        {ENRICH_FEED.map((r, i) => (
          <div key={r.e} className={`flex items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm ${i === 1 ? "ml-8" : ""}`}>
            <Image src={FACES[i + 1]} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-foreground">{r.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{r.e}</div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {r.wa
                ? <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600"><MessageCircle className="h-3 w-3" /> WhatsApp</span>
                : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Email</span>}
            </div>
          </div>
        ))}
      </div>
      {/* collaboration cursors */}
      <span className="absolute right-6 top-6 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow">You</span>
      <span className="absolute bottom-8 left-6 rounded-md bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">Team</span>
    </div>
  );
}

/* -------------------------------------------------------- bento widgets -- */

function Sparkline() {
  return (
    <svg viewBox="0 0 120 36" className="h-9 w-28">
      <path d="M0,30 L14,22 L26,26 L40,12 L54,18 L68,8 L82,16 L96,5 L120,2" fill="none" stroke="#7cc20a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
            <span key={s} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${i === 0 ? "bg-[#a2e435]/25 text-[#3a6b00]" : "border border-border bg-card text-muted-foreground"}`}>{s}</span>
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
              <div className="mt-1 h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-gradient-to-r from-primary to-violet-500" style={{ width: b.p }} /></div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <Mail className="h-3.5 w-3.5 text-violet-600" /> office@hillcountryhvac.com
          <MessageCircle className="ml-auto h-3.5 w-3.5 text-emerald-600" />
        </div>
      </div>
    );
  }
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div className="font-heading text-sm font-bold">Pipeline</div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#a2e435]/25 px-2.5 py-1 text-xs font-semibold text-[#3a6b00]"><FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV</span>
      </div>
      <div className="mt-4 space-y-2">
        {[{ n: "Hill Country HVAC", s: "Contacted", c: "bg-sky-500/10 text-sky-600" }, { n: "Barton Electric", s: "Replied", c: "bg-emerald-500/10 text-emerald-600" }, { n: "Capital Roofing", s: "To call", c: "bg-amber-500/10 text-amber-600" }, { n: "Lone Star Plumbing", s: "Won", c: "bg-[#a2e435]/30 text-[#3a6b00]" }].map((r) => (
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

function PriceCard({ plan }) {
  const Icon = PLAN_ICONS[plan.id];
  const blue = plan.style === "blue";
  const dark = plan.style === "dark";

  const shell = blue
    ? "border-transparent bg-gradient-to-b from-primary to-blue-600 text-white shadow-2xl shadow-primary/30"
    : dark
      ? "border-transparent bg-[#0a0e1a] text-white"
      : "border-border bg-card";
  const sub = blue ? "text-white/75" : dark ? "text-white/60" : "text-muted-foreground";
  const tile = blue ? "bg-white/15 text-white" : dark ? "bg-white/10 text-white" : "bg-primary/10 text-primary";
  const per = blue ? "text-white/75" : dark ? "text-white/60" : "text-muted-foreground";
  const rule = blue || dark ? "bg-white/15" : "bg-border";
  const checkWrap = blue ? "bg-white/20 text-white" : dark ? "bg-white/10 text-[#a2e435]" : "bg-[#a2e435]/30 text-[#3a6b00]";
  const perkText = blue ? "text-white/90" : dark ? "text-white/70" : "text-muted-foreground";

  const btnClass = blue ? "lf-cta bg-white text-primary hover:bg-white/90"
    : dark ? "lf-cta bg-white text-slate-900 hover:bg-white/90" : "";
  const btnVariant = blue || dark ? "default" : "outline";

  return (
    <div className={`relative flex h-full flex-col rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1.5 ${shell} ${blue ? "lg:-mt-4 lg:mb-4" : ""}`}>
      {plan.popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#a2e435] px-3 py-1 text-xs font-semibold text-[#23420a] shadow-lg">Most popular</span>
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

      <GoogleSignInButton callbackUrl={plan.callbackUrl} className={`mt-6 w-full rounded-xl ${btnClass}`} variant={btnVariant}>
        {plan.cta}
      </GoogleSignInButton>

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
        const tilt = i % 2 === 0 ? 2.2 : -2.2;
        const depth = clamp(active - i - 0.6, 0, 3); // how far behind the front
        el.style.transform = `scale(${1 - depth * 0.05}) rotate(${tilt}deg)`;
        el.style.opacity = String(1 - depth * 0.06);
      });
    };

    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className="space-y-5 lg:space-y-12">
      {DISCOVER.map((d, i) => (
        <div key={d.title} className="lg:sticky" style={{ top: `${100 + i * 16}px` }}>
          <div
            ref={(el) => (cardRefs.current[i] = el)}
            style={{ transformOrigin: "center top", willChange: "transform", transform: `rotate(${i % 2 === 0 ? "2.2deg" : "-2.2deg"})` }}
            className={`relative min-h-[180px] overflow-hidden rounded-3xl border border-border bg-card bg-gradient-to-br ${d.grad} p-7 ring-1 ${d.ring} shadow-xl shadow-black/[0.07]`}
          >
            <span className={`absolute right-5 top-5 h-2.5 w-2.5 rounded-full ${d.dot} shadow-[0_0_0_4px_rgba(255,255,255,0.6)]`} />
            <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${d.chip}`}><d.icon className="h-5 w-5" /></div>
            <h3 className="font-heading text-xl font-bold text-foreground">{d.title}</h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-foreground/70">{d.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- page -- */

export default function Landing() {
  const [step, setStep] = useState(0);

  return (
    <div className={`lf relative min-h-screen overflow-x-clip bg-background text-foreground ${HATCH}`}>
      {/* ambient colourful blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute -right-48 top-40 h-[30rem] w-[30rem] rounded-full bg-violet-400/12 blur-3xl" />
        <div className="absolute left-1/3 top-[48rem] h-[26rem] w-[26rem] rounded-full bg-[#a2e435]/12 blur-3xl" />
      </div>

      {/* ---- nav ---- */}
      <header className="sticky top-3 z-40 px-4">
        <div className="container">
          <div className="flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 pl-5 shadow-sm backdrop-blur-xl">
            <Logo />
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 text-sm font-medium md:flex">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{n.label}</a>
              ))}
            </nav>
            <GoogleSignInButton size="sm" className="lf-cta rounded-xl">Get started</GoogleSignInButton>
          </div>
        </div>
      </header>

      {/* ---- hero ---- */}
      <section className="relative px-4">
        <div className="container flex flex-col items-center pb-10 pt-16 text-center sm:pt-24">
          <span className="lf-shine mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground/80 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#a2e435] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7cc20a]" />
            </span>
            Google Maps lead generation, on autopilot
          </span>
          <h1 className="font-heading max-w-4xl text-5xl font-bold leading-[1.03] tracking-tight sm:text-6xl xl:text-[5.25rem]">
            Turn Google Maps into a{" "}
            <span className="relative text-primary sm:whitespace-nowrap">
              pipeline of leads
              <span className="absolute -bottom-1 left-0 h-3 w-full rounded-full bg-[#a2e435]/50" />
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-lg text-muted-foreground">
            Scrape any niche, enrich every lead with emails, socials and WhatsApp, and spot prospects whose websites need help, all from one dashboard.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <GoogleSignInButton size="lg" className="lf-cta rounded-xl px-7">Start free with Google</GoogleSignInButton>
            <Button asChild variant="outline" size="lg" className="rounded-xl bg-card px-7 shadow-sm hover:bg-muted">
              <a href="#features">See how it works <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <AvatarStack />
            <span className="text-sm text-muted-foreground">Trusted by <span className="font-semibold text-foreground">2,400+</span> marketers</span>
            <span className="flex items-center gap-1.5"><Stars /> <span className="text-sm font-semibold text-foreground">5.0</span></span>
          </div>
        </div>

        <HeroApp />
      </section>

      {/* ---- trust strip ---- */}
      <section className="border-y border-border/60 bg-card/40 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-blue-600" /> Real-Chrome website audits</span>
          <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp detection</span>
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-violet-600" /> Email + social enrichment</span>
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-rose-600" /> Private &amp; isolated data</span>
        </div>
      </section>

      {/* ---- about + pills ---- */}
      <section id="about" className="container py-24">
        <Reveal className="mx-auto max-w-3xl text-center">
          <Eyebrow icon={Users}>Why LeadsFunda</Eyebrow>
          <p className="font-heading mx-auto mt-6 max-w-2xl text-2xl font-bold leading-snug tracking-tight sm:text-[2rem]">
            Everything you need to find local businesses, reach the decision-maker and know exactly who needs your help, in one tab.
          </p>
        </Reveal>
        <Reveal delay={120} className="mx-auto mt-9 flex max-w-3xl flex-wrap items-center justify-center gap-3">
          {PILLS.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} /> {p.label}
            </span>
          ))}
        </Reveal>
      </section>

      {/* ---- smarter research: two widget cards ---- */}
      <section className="container pb-8">
        <Reveal>
          <SectionHead icon={Sparkles} eyebrow="See it work" title="From raw Maps listing to ready-to-pitch lead"
            sub="Let LeadsFunda do the heavy lifting. It gathers every business, then enriches and scores it for you." className="mb-12" />
        </Reveal>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Reveal className="relative overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-sm">
            <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-rose-400/10 blur-2xl" />
            <h3 className="font-heading text-xl font-bold">Your pipeline at a glance</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">See lead volume, closes and revenue trend so you always know which niches are paying off.</p>
            <TrendChart />
          </Reveal>
          <Reveal delay={120} className="relative overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-sm">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
            <h3 className="font-heading text-xl font-bold">Contacts ready to send</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Emails, socials and WhatsApp pulled from each business's own site, sendable the second it lands.</p>
            <EnrichChat />
          </Reveal>
        </div>
      </section>

      {/* ---- discover: sticky-left + pastel card stack ---- */}
      <section className="border-y border-border/60 bg-muted/20 py-24">
        <div className="container grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div className="lg:sticky lg:top-28 lg:h-fit lg:self-start">
            <Eyebrow icon={Sparkles}>Features</Eyebrow>
            <h2 className="font-heading mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]">Discover everything we built with you in mind</h2>
            <p className="mt-4 max-w-md text-muted-foreground">From smart filters to one-click export, every detail is crafted to make lead-gen smoother, faster and more impactful, so you spend time closing, not collecting.</p>
            <div className="mt-7 hidden lg:block">
              <GoogleSignInButton size="lg" className="lf-cta rounded-xl px-7">Start free with Google</GoogleSignInButton>
            </div>
          </div>
          <DiscoverCards />
        </div>
      </section>

      {/* ---- bento: everything in one tab ---- */}
      <section id="features" className="container py-24">
        <Reveal><SectionHead icon={Sparkles} eyebrow="Features" title="Everything in one tab"
          sub="Scrape, enrich, audit and organize. The whole outreach workflow, with no stitching tools together." className="mb-12" /></Reveal>
        <div className="grid grid-cols-1 auto-rows-fr gap-5 lg:grid-cols-6">
          {/* row 1: three equal cells */}
          <Reveal className="lg:col-span-2"><BentoCell icon={MapPin} tile="bg-blue-500/10 text-blue-600" title="Scrape Google Maps" body="Name, phone, website, rating, reviews and hours for any niche + city.">
            <div className="space-y-2">
              {SCRAPE_FEED.slice(0, 3).map((r) => (
                <div key={r.n} className="flex items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-1.5 text-[11px] shadow-sm">
                  <Building2 className="h-3.5 w-3.5 text-blue-600" /><span className="truncate font-medium text-foreground">{r.n}</span>
                  <span className="ml-auto text-muted-foreground">{r.m}</span>
                </div>
              ))}
            </div>
          </BentoCell></Reveal>

          <Reveal delay={90} className="lg:col-span-2"><BentoCell icon={Mail} tile="bg-violet-500/10 text-violet-600" title="Enrich every contact" body="Emails, socials and WhatsApp crawled from each business's own website.">
            <div className="flex flex-wrap gap-2">
              {[{ t: "Email", c: "bg-violet-500/10 text-violet-600" }, { t: "WhatsApp", c: "bg-emerald-500/10 text-emerald-600" }, { t: "Instagram", c: "bg-rose-500/10 text-rose-600" }, { t: "Facebook", c: "bg-blue-500/10 text-blue-600" }, { t: "LinkedIn", c: "bg-sky-500/10 text-sky-600" }].map((s) => (
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
          <Reveal delay={120} className="lg:col-span-2"><BentoCell icon={Zap} tile="bg-cyan-500/10 text-cyan-600" title="Instant delivery" body="Leads arrive in seconds from our pre-built database — no scraping delays, no browser needed.">
            <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-3">
              <div><div className="text-[11px] text-muted-foreground">Avg. delivery</div><div className="font-heading text-lg font-bold text-foreground">< 5s</div></div>
              <Sparkline />
            </div>
          </BentoCell></Reveal>

          <Reveal delay={210} className="lg:col-span-4"><BentoCell icon={Activity} tile="bg-emerald-500/10 text-emerald-600" title="Actionable insights" body="See what's landing in real time and pounce on the warmest prospects first.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-3">
                <div><div className="text-[11px] text-muted-foreground">Leads today</div><div className="font-heading text-xl font-bold text-foreground">2,400 <span className="text-xs font-semibold text-emerald-600">+10%</span></div></div>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#a2e435]/25 text-[#3a6b00]"><TrendingUp className="h-4 w-4" /></span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bell className="h-4 w-4" /></span>
                <div className="leading-tight"><div className="text-xs font-semibold text-foreground">New lead captured</div><div className="text-[11px] text-muted-foreground">+1 to Plumbers · Austin</div></div>
              </div>
            </div>
          </BentoCell></Reveal>
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
                  {active && <span className="absolute inset-x-5 top-0 h-1 rounded-full bg-gradient-to-r from-primary to-violet-500" />}
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
                    <Image src={FACES[i % FACES.length]} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
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
        <div className="rounded-[2rem] border border-border bg-muted/30 p-5 sm:p-8">
          {/* decorative period toggle: monthly only for now */}
          <div className="mb-8 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 text-sm shadow-sm">
              <span className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-background">Monthly</span>
              <span className="flex cursor-not-allowed items-center gap-1.5 rounded-full px-4 py-1.5 font-medium text-muted-foreground/60">
                Yearly <span className="rounded-full bg-[#a2e435]/30 px-2 py-0.5 text-[10px] font-semibold text-[#3a6b00]">Save 30%</span>
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-4">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 80}><PriceCard plan={plan} /></Reveal>
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
          <div className="mx-auto grid grid-cols-1 max-w-5xl gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {FAQ.map((item, i) => (
              <Reveal key={item.q} delay={(i % 3) * 90}>
                <h3 className="font-heading text-lg font-bold text-foreground">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- cta banner ---- */}
      <section className="container py-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary via-blue-600 to-violet-600 px-6 py-16 text-center text-white">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-[#a2e435]/25 blur-2xl" />
          <h2 className="font-heading mx-auto max-w-xl text-3xl font-bold sm:text-4xl">Ready to build your lead list?</h2>
          <p className="mx-auto mt-3 max-w-lg text-white/80">Sign in with Google and run your first scrape in minutes.</p>
          <div className="mt-7 flex justify-center">
            <GoogleSignInButton size="lg" variant="secondary" className="lf-cta rounded-xl px-7">Start free with Google</GoogleSignInButton>
          </div>
        </div>
      </section>

      {/* ---- footer (light card, like the template) ---- */}
      <footer className="px-4 pb-6">
        <div className={`container overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm ${HATCH}`}>
          <div className="grid grid-cols-1 gap-10 p-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Logo />
              <p className="mt-4 max-w-xs text-sm text-muted-foreground">Turn Google Maps into a pipeline of enriched, ready-to-pitch leads.</p>
              <div className="mt-6"><GoogleSignInButton size="sm" className="lf-cta rounded-xl">Start free with Google</GoogleSignInButton></div>
            </div>
            <div>
              <div className="mb-4 text-sm font-semibold text-foreground">Pages</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {NAV.map((n) => <li key={n.href}><a href={n.href} className="transition-colors hover:text-foreground">{n.label}</a></li>)}
              </ul>
            </div>
            <div>
              <div className="mb-4 text-sm font-semibold text-foreground">Social</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#" className="transition-colors hover:text-foreground">X (Twitter)</a></li>
                <li><a href="#" className="transition-colors hover:text-foreground">LinkedIn</a></li>
                <li><a href="#" className="transition-colors hover:text-foreground">YouTube</a></li>
              </ul>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-2 border-t border-border px-10 py-5 text-sm text-muted-foreground sm:flex-row">
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
