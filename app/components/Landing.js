"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  MapPin,
  Mail,
  Activity,
  ListChecks,
  ShieldCheck,
  Check,
  Search,
  Star,
  Globe2,
  MessageCircle,
  ArrowRight,
  Cloud,
  Lock,
  Plus,
  Minus,
  Play,
  Zap,
  Building2,
  Phone,
  Gauge,
  AlertTriangle,
} from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button } from "./ui/button";

// Lightweight scroll-reveal: fades + slides children up the first time they
// enter the viewport. No dependency — just an IntersectionObserver.
function Reveal({ children, className = "", delay = 0 }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
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

// Click-to-play hero video: shows the poster + a play button and downloads
// nothing until the user clicks (preload="none"), then plays with sound.
function HeroVideo() {
  const [playing, setPlaying] = useState(false);
  const ref = useRef(null);
  return (
    <div className="relative aspect-video w-full bg-muted">
      <video
        ref={ref}
        className="block h-full w-full object-cover"
        src="/leadsfunda-hyperframes.mp4"
        poster="/leadsfunda-hero-poster.jpg"
        preload="none"
        playsInline
        controls={playing}
        onClick={() => playing && ref.current?.paused && ref.current.play()}
      />
      {!playing && (
        <button
          type="button"
          aria-label="Play demo with sound"
          onClick={() => {
            setPlaying(true);
            // play after controls render so audio is unmuted (user gesture)
            requestAnimationFrame(() => ref.current?.play());
          }}
          className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/30 to-transparent"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 shadow-2xl shadow-primary/30 ring-1 ring-black/5 transition-transform duration-300 group-hover:scale-110">
            <Play className="ml-1 h-8 w-8 fill-primary text-primary" />
          </span>
          <span className="absolute bottom-5 rounded-full bg-black/60 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
            Watch the 30s demo
          </span>
        </button>
      )}
    </div>
  );
}

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

// Six-card bento, each with its own accent so the grid reads colorful like the
// template while the brand blue stays primary. Classes written out for JIT.
const FEATURES = [
  { icon: MapPin, tile: "bg-blue-500/10 text-blue-600", title: "Scrape Google Maps", body: "Pull name, phone, website, address, rating, reviews and hours for any niche + location. Fast, deduped, resumable." },
  { icon: Mail, tile: "bg-violet-500/10 text-violet-600", title: "Enrich contacts", body: "Crawl each lead's site for emails, social profiles and WhatsApp so your list is ready to outreach the moment it lands." },
  { icon: Activity, tile: "bg-emerald-500/10 text-emerald-600", title: "Website health", body: "Real-Chrome audits, HTTP status and chatbot detection surface prospects whose sites clearly need work." },
  { icon: ListChecks, tile: "bg-orange-500/10 text-orange-600", title: "Workflow built in", body: "Watchlists, email decisions, outreach status and notes keep your pipeline organized from scrape to closed." },
  { icon: Cloud, tile: "bg-cyan-500/10 text-cyan-600", title: "Runs in the cloud", body: "Jobs run on our servers and queue automatically. Start a scrape, close the tab, get notified when it's done." },
  { icon: Lock, tile: "bg-rose-500/10 text-rose-600", title: "Your data, isolated", body: "Every account's leads and projects are private and protected. Never shared, never resold." },
];

const STEPS = [
  { n: "01", title: "Pick a niche & city", body: "Choose a service and location, or paste your own Maps query. Set how many leads you want." },
  { n: "02", title: "We scrape & enrich", body: "We pull every business, then crawl their sites for emails, socials and WhatsApp, automatically." },
  { n: "03", title: "Work the pipeline", body: "Filter, audit websites, mark outreach status and export a clean CSV ready for your campaigns." },
];

const STATS = [
  { v: "2.4M+", l: "Leads scraped" },
  { v: "190+", l: "Niches covered" },
  { v: "9", l: "Socials per lead" },
  { v: "6", l: "Jobs run in parallel" },
];

// Real avatar photos so the trust stack + testimonials show actual faces
// instead of flat colored dots.
const FACES = [
  "/avatars/women-44.jpg",
  "/avatars/men-32.jpg",
  "/avatars/women-68.jpg",
  "/avatars/men-76.jpg",
  "/avatars/women-90.jpg",
  "/avatars/men-12.jpg",
];

const TESTIMONIALS = [
  { name: "Marcus D.", role: "Agency owner", body: "Pulled 1,200 plumbers in an afternoon and half had no website — instant pitch list." },
  { name: "Priya N.", role: "Freelance SDR", body: "The email + WhatsApp enrichment sold me. My list is ready to outreach the second it lands." },
  { name: "Tom R.", role: "Web designer", body: "Website health scoring tells me exactly who to call first. Game-changer for cold outreach." },
  { name: "Lena K.", role: "Growth marketer", body: "I cancelled three tools after switching. Scrape, enrich and audit all in one tab." },
  { name: "Sergio A.", role: "Lead-gen", body: "Runs in the cloud, so I close the laptop and the leads are waiting when I'm back." },
  { name: "Dana W.", role: "Sales ops", body: "Cleanest CSV exports I've used — straight into my CRM, zero cleanup." },
];

const PLANS = [
  { id: "p19", name: "Starter", price: "19", quota: "5,000 credits / month", sub: "For solo prospectors finding their first leads", popular: false, accent: "text-blue-600",
    perks: ["5,000 credits / mo", "Email + social enrichment", "Website health checks", "CSV export"] },
  { id: "p35", name: "Growth", price: "35", quota: "50,000 credits / month", sub: "For freelancers running steady outreach", popular: true, accent: "text-primary",
    perks: ["50,000 credits / mo", "Everything in Starter", "Priority in the job queue", "WhatsApp checks"] },
  { id: "p49", name: "Scale", price: "49", quota: "Unlimited credits / month", sub: "For agencies scraping at volume", popular: false, accent: "text-violet-600",
    perks: ["Unlimited credits / mo", "Everything in Growth", "Highest queue priority", "Best for agencies"] },
];

const FAQ = [
  { q: "Do I need to install anything?", a: "No. LeadsFunda runs entirely in the cloud. Sign in with Google, start a scrape, and your leads appear in the dashboard — even if you close the tab." },
  { q: "Where do the leads come from?", a: "Public Google Maps business listings for the niche and location you choose. We then visit each business's own website to enrich emails and social profiles." },
  { q: "Can I cancel anytime?", a: "Yes. Plans are monthly and managed through Whop. Upgrade, downgrade or cancel whenever you like — no contracts." },
  { q: "What counts as a credit?", a: "Finding a lead costs 1 credit; a quick audit 3, a chatbot scan 5, and a full website report 10. Re-checking a lead you already own is free." },
  { q: "Is my data safe?", a: "Every account's leads and projects are fully isolated and protected. We never share or resell your data." },
  { q: "How fast is a scrape?", a: "Jobs run on our servers with up to six in parallel, so a few thousand leads typically finish while you grab a coffee." },
];

function Stars() {
  return (
    <div className="flex items-center gap-0.5 text-amber-400">
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
    </div>
  );
}

// Stack of real avatar photos used in the hero trust row.
function AvatarStack() {
  return (
    <div className="flex -space-x-2.5">
      {FACES.slice(0, 5).map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          width={34}
          height={34}
          className="h-[34px] w-[34px] rounded-full border-2 border-background object-cover shadow-sm"
        />
      ))}
    </div>
  );
}

// A small frosted chip that floats around the hero product window. Hidden on
// narrow screens so it never overlaps the video.
function FloatChip({ className = "", icon: Icon, tone, children, delay = 0 }) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-float absolute z-20 hidden items-center gap-2.5 rounded-2xl border border-border bg-card/90 px-3.5 py-2.5 shadow-xl shadow-black/5 backdrop-blur-md lg:flex ${className}`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-left leading-tight">{children}</div>
    </div>
  );
}

// Seamless vertical auto-scroll for the live mini-UI showcase panels. The rows
// are duplicated, so the -50% loop has no visible seam.
function ScrollColumn({ items, duration = 16 }) {
  return (
    <div className="relative mt-4 h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]">
      <div className="animate-scroll-y space-y-2" style={{ animationDuration: `${duration}s` }}>
        {[...items, ...items].map((node, i) => (
          <div key={i}>{node}</div>
        ))}
      </div>
    </div>
  );
}

// ── Live showcase data ──────────────────────────────────────────────────────
const SCRAPE_FEED = [
  { n: "Lone Star Plumbing", m: "+1 (512) 555-0182" },
  { n: "Hill Country HVAC", m: "+1 (512) 555-0143" },
  { n: "Capital Roofing Co.", m: "+1 (512) 555-0117" },
  { n: "Barton Electric", m: "+1 (512) 555-0164" },
  { n: "Travis County Garage", m: "+1 (512) 555-0199" },
  { n: "Zilker Landscaping", m: "+1 (512) 555-0128" },
];

const ENRICH_FEED = [
  { e: "office@hillcountryhvac.com", wa: true },
  { e: "team@bartonelectric.com", wa: true },
  { e: "hello@lonestarplumb.com", wa: false },
  { e: "info@capitalroofing.co", wa: true },
  { e: "contact@zilkerland.com", wa: false },
  { e: "service@traviscgarage.com", wa: true },
];

const AUDIT_FEED = [
  { l: "No SSL certificate", tone: "text-rose-600 bg-rose-500/10" },
  { l: "Slow load · 4.2s LCP", tone: "text-amber-600 bg-amber-500/10" },
  { l: "No mobile layout", tone: "text-rose-600 bg-rose-500/10" },
  { l: "Missing meta title", tone: "text-amber-600 bg-amber-500/10" },
  { l: "No chatbot detected", tone: "text-violet-600 bg-violet-500/10" },
  { l: "Outdated copyright", tone: "text-amber-600 bg-amber-500/10" },
];

// One live card in the showcase: icon + title + one-line copy on top, an
// auto-scrolling mini-UI panel below.
function LiveCard({ icon: Icon, tile, title, body, header, headerTone, items, duration }) {
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10">
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${tile} transition-transform duration-300 group-hover:scale-110`}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-heading text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {/* Mini app panel */}
      <div className="mt-5 rounded-2xl border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 ${headerTone}`}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            {header}
          </span>
        </div>
        <ScrollColumn items={items} duration={duration} />
      </div>
    </div>
  );
}

function FaqItem({ q, a, open, onClick }) {
  return (
    <div className={`overflow-hidden rounded-2xl border bg-card transition-colors ${open ? "border-primary/40 shadow-sm shadow-primary/5" : "border-border"}`}>
      <button onClick={onClick} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="font-heading text-base font-semibold text-foreground">{q}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${open ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{a}</p>
        </div>
      </div>
    </div>
  );
}

function TestimonialCard({ t, i }) {
  return (
    <div className="w-[340px] shrink-0 rounded-3xl border border-border bg-card p-6 shadow-sm">
      <Stars />
      <p className="mt-3 text-sm leading-relaxed text-foreground">“{t.body}”</p>
      <div className="mt-4 flex items-center gap-3">
        <Image src={FACES[i % FACES.length]} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" />
        <div>
          <div className="text-sm font-semibold text-foreground">{t.name}</div>
          <div className="text-xs text-muted-foreground">{t.role}</div>
        </div>
      </div>
    </div>
  );
}

export default function Landing({ checkout = {} }) {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <div className="lf relative min-h-screen overflow-x-clip bg-background text-foreground">
      {/* Ambient colorful blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -right-48 top-32 h-[30rem] w-[30rem] rounded-full bg-violet-400/15 blur-3xl" />
        <div className="absolute left-1/3 top-[46rem] h-[26rem] w-[26rem] rounded-full bg-[#a2e435]/15 blur-3xl" />
      </div>

      {/* Nav — pill, blurred, centered links like the template */}
      <header className="sticky top-3 z-40 px-4">
        <div className="container">
          <div className="flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 pl-5 shadow-sm backdrop-blur-xl">
            <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={140} height={27} priority />
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="transition-colors hover:text-foreground">{n.label}</a>
              ))}
            </nav>
            <GoogleSignInButton size="sm" className="lf-cta rounded-full">Get started</GoogleSignInButton>
          </div>
        </div>
      </header>

      {/* Hero — centered, then the product window with the video */}
      <section className="relative px-4">
        <div className="container flex flex-col items-center pb-10 pt-16 text-center sm:pt-24">
          <span className="lf-shine mb-7 inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-3.5 py-1.5 text-sm font-medium text-foreground/80">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#a2e435] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7cc20a]" />
            </span>
            <Zap className="h-3.5 w-3.5 fill-primary text-primary" />
            Google Maps lead generation, on autopilot
          </span>
          <h1 className="font-heading max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl xl:text-7xl">
            Turn Google Maps into a{" "}
            <span className="relative whitespace-nowrap text-primary">
              pipeline of leads
              <span className="absolute -bottom-1 left-0 h-3 w-full rounded-full bg-[#a2e435]/50" />
            </span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg text-muted-foreground">
            Scrape any niche, enrich every lead with emails, socials and WhatsApp, and spot prospects whose
            websites need help — all from one dashboard.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <GoogleSignInButton size="lg" className="lf-cta rounded-full px-7">Start free with Google</GoogleSignInButton>
            <Button asChild variant="outline" size="lg" className="rounded-full bg-card px-7 shadow-sm hover:bg-muted">
              <a href="#how">See how it works <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </div>
          {/* Trust row: stacked real avatars + rating */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <AvatarStack />
            <span className="text-sm text-muted-foreground">Trusted by <span className="font-semibold text-foreground">2,400+</span> marketers</span>
            <span className="flex items-center gap-1.5"><Stars /> <span className="text-sm font-semibold text-foreground">5.0</span></span>
          </div>
        </div>

        {/* Product window — the hero video lives here, with floating accent chips */}
        <div className="container relative max-w-5xl pb-8">
          <div className="pointer-events-none absolute -inset-x-10 -top-6 bottom-10 -z-10 rounded-[3rem] bg-gradient-to-tr from-primary/25 via-violet-400/20 to-[#a2e435]/25 blur-3xl" />

          <FloatChip className="-left-6 top-12" icon={Search} tone="bg-blue-500/10 text-blue-600" delay={0}>
            <div className="text-sm font-semibold text-foreground">1,284 leads</div>
            <div className="text-[11px] text-muted-foreground">found in 4m 12s</div>
          </FloatChip>
          <FloatChip className="-right-6 top-28" icon={Mail} tone="bg-violet-500/10 text-violet-600" delay={700}>
            <div className="text-sm font-semibold text-foreground">912 emails</div>
            <div className="text-[11px] text-muted-foreground">enriched & verified</div>
          </FloatChip>
          <FloatChip className="-left-4 bottom-16" icon={MessageCircle} tone="bg-emerald-500/10 text-emerald-600" delay={1400}>
            <div className="text-sm font-semibold text-foreground">347 on WhatsApp</div>
            <div className="text-[11px] text-muted-foreground">ready to message</div>
          </FloatChip>

          <div className="overflow-hidden rounded-[1.6rem] border border-border bg-card shadow-2xl shadow-primary/10">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-rose-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
              <div className="mx-auto flex items-center gap-2 rounded-full bg-background/70 px-4 py-1 text-xs text-muted-foreground">
                <Globe2 className="h-3 w-3" /> app.leadsfunda.com
              </div>
            </div>
            <HeroVideo />
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-y border-border/60 bg-card/40 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-blue-600" /> Real-Chrome website audits</span>
          <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp detection</span>
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-violet-600" /> Email + social enrichment</span>
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-rose-600" /> Private &amp; isolated data</span>
        </div>
      </section>

      {/* Live showcase — three cards with auto-scrolling mini-UIs */}
      <section className="container py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">See it work</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">From raw Maps listing to ready-to-pitch lead</h2>
          <p className="mt-3 text-muted-foreground">Scrape, enrich and audit run live — no stitching together five different tools.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Reveal>
            <LiveCard
              icon={Search}
              tile="bg-blue-500/10 text-blue-600"
              title="Scrape every business"
              body="Name, phone, website, rating and hours for any niche + city — deduped and resumable."
              header="scraping · Austin TX"
              headerTone="bg-blue-500/10 text-blue-600"
              duration={15}
              items={SCRAPE_FEED.map((r) => (
                <div className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-xs shadow-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"><Building2 className="h-3.5 w-3.5" /></span>
                  <span className="truncate font-medium text-foreground">{r.n}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" /> {r.m.slice(-7)}</span>
                </div>
              ))}
            />
          </Reveal>
          <Reveal delay={120}>
            <LiveCard
              icon={Mail}
              tile="bg-violet-500/10 text-violet-600"
              title="Enrich every contact"
              body="Emails, socials and WhatsApp pulled from each site, so your list is sendable on arrival."
              header="enriching contacts"
              headerTone="bg-violet-500/10 text-violet-600"
              duration={17}
              items={ENRICH_FEED.map((r) => (
                <div className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-xs shadow-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600"><Mail className="h-3.5 w-3.5" /></span>
                  <span className="truncate font-medium text-foreground">{r.e}</span>
                  {r.wa
                    ? <MessageCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    : <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                </div>
              ))}
            />
          </Reveal>
          <Reveal delay={240}>
            <LiveCard
              icon={Gauge}
              tile="bg-emerald-500/10 text-emerald-600"
              title="Audit their website"
              body="Real-Chrome checks flag broken, slow or missing sites — your warmest pitch list, scored."
              header="auditing sites"
              headerTone="bg-emerald-500/10 text-emerald-600"
              duration={16}
              items={AUDIT_FEED.map((r) => (
                <div className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-xs shadow-sm">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${r.tone}`}><AlertTriangle className="h-3.5 w-3.5" /></span>
                  <span className="truncate font-medium text-foreground">{r.l}</span>
                </div>
              ))}
            />
          </Reveal>
        </div>
      </section>

      {/* Bento feature grid */}
      <section id="features" className="container py-12">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">Everything in one place</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Built for people who actually outreach</h2>
          <p className="mt-3 text-muted-foreground">Every detail is crafted to make lead-gen smoother, faster and more impactful.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, tile }, i) => (
            <Reveal key={title} delay={(i % 3) * 90}>
              <div className="group h-full rounded-3xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10">
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${tile} transition-transform duration-300 group-hover:scale-110`}><Icon className="h-5 w-5" /></div>
                <h3 className="font-heading text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border/60 bg-card/30 py-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-sm font-semibold uppercase tracking-wider text-primary">How to use</span>
            <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Designed for simplicity</h2>
            <p className="mt-3 text-muted-foreground">Three steps from a niche to a full pipeline.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map(({ n, title, body }, i) => (
              <Reveal key={n} delay={i * 120}>
                <div className="group relative h-full overflow-hidden rounded-3xl border border-border bg-card p-7 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-primary/10">
                  <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-primary/20 to-transparent blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-60" />
                  <span className="font-heading block bg-gradient-to-br from-primary to-violet-500 bg-clip-text text-5xl font-bold text-transparent">{n}</span>
                  <h3 className="font-heading mt-4 text-lg font-bold">{title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="container py-16">
        <div className="grid grid-cols-2 gap-6 rounded-3xl border border-border bg-gradient-to-br from-card to-muted/40 p-10 text-center md:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.l} delay={i * 90}>
              <div className="font-heading text-3xl font-bold text-foreground sm:text-4xl">{s.v}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.l}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Testimonials — two rows scrolling opposite directions, pause on hover */}
      <section className="overflow-hidden py-16">
        <Reveal className="container mx-auto mb-12 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">Testimonials</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">What our users are saying</h2>
          <p className="mt-3 text-muted-foreground">Real feedback from people who run outreach every day.</p>
        </Reveal>
        <div className="relative space-y-5 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
          <div className="flex w-max gap-5 animate-marquee hover:[animation-play-state:paused]">
            {[...TESTIMONIALS, ...TESTIMONIALS].map((t, i) => <TestimonialCard key={`a${i}`} t={t} i={i} />)}
          </div>
          <div className="flex w-max gap-5 animate-marquee-reverse hover:[animation-play-state:paused]">
            {[...TESTIMONIALS.slice().reverse(), ...TESTIMONIALS.slice().reverse()].map((t, i) => <TestimonialCard key={`b${i}`} t={t} i={i + 2} />)}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="container py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">Pricing</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Simple plans for every stage</h2>
          <p className="mt-3 text-muted-foreground">Pick a monthly credit pack. Upgrade or cancel anytime.</p>
        </div>
        <div className="mx-auto grid max-w-5xl items-stretch gap-6 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 90} className={plan.popular ? "lg:-mt-4 lg:mb-4" : ""}>
              <div className={`relative flex h-full flex-col rounded-3xl border bg-card p-7 transition-all duration-300 hover:-translate-y-1.5 ${plan.popular ? "border-transparent shadow-2xl shadow-primary/20" : "border-border hover:shadow-xl hover:shadow-primary/10"}`}>
                {plan.popular && (
                  <>
                    <span className="pointer-events-none absolute -inset-[1.5px] -z-10 rounded-[inherit] bg-[linear-gradient(120deg,#3147ff,#8b5cf6,#a2e435,#3147ff)] bg-[length:300%_300%] animate-gradient-pan" />
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/30">Most popular</span>
                  </>
                )}
                <div className={`flex items-center gap-2 text-sm font-semibold ${plan.accent}`}>
                  <span className="inline-block h-2 w-2 rounded-full bg-current" />
                  {plan.name}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{plan.sub}</p>
                <div className="mt-5 flex items-end gap-1">
                  <span className="font-heading text-5xl font-bold tracking-tight">${plan.price}</span>
                  <span className="mb-1.5 text-sm text-muted-foreground">/ month</span>
                </div>
                <div className="mt-1 text-sm font-medium text-muted-foreground">{plan.quota}</div>
                {checkout[plan.id] ? (
                  <Button asChild className={`mt-6 w-full rounded-full ${plan.popular ? "lf-cta" : ""}`} variant={plan.popular ? "default" : "outline"}>
                    <a href={checkout[plan.id]} target="_blank" rel="noreferrer">Get started</a>
                  </Button>
                ) : (
                  <GoogleSignInButton className={`mt-6 w-full rounded-full ${plan.popular ? "lf-cta" : ""}`} variant={plan.popular ? "default" : "outline"}>Get started</GoogleSignInButton>
                )}
                <div className="my-6 h-px bg-border" />
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">What&apos;s included</div>
                <ul className="space-y-3 text-sm">
                  {plan.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#a2e435]/30 text-[#3a6b00]"><Check className="h-3 w-3" /></span>
                      <span className="text-muted-foreground">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Payments are processed securely by Whop. Sign in with Google first, then subscribe.</p>
      </section>

      {/* FAQ accordion */}
      <section id="faq" className="container py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">FAQs</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Explore our FAQs</h2>
          <p className="mt-3 text-muted-foreground">Quick answers to the questions we hear most.</p>
        </div>
        <div className="mx-auto grid max-w-3xl gap-3">
          {FAQ.map((item, i) => (
            <FaqItem key={item.q} {...item} open={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? -1 : i)} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container py-16">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary via-blue-600 to-violet-600 px-6 py-16 text-center text-white">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-[#a2e435]/20 blur-2xl" />
          <h2 className="font-heading mx-auto max-w-xl text-3xl font-bold sm:text-4xl">Ready to build your lead list?</h2>
          <p className="mx-auto mt-3 max-w-lg text-white/80">Sign in with Google and run your first scrape in minutes.</p>
          <div className="mt-7 flex justify-center">
            <GoogleSignInButton size="lg" variant="secondary" className="lf-cta rounded-full px-7">Start free with Google</GoogleSignInButton>
          </div>
        </div>
      </section>

      {/* Footer — dark, glowing, with a giant clipped wordmark */}
      <footer className="relative mt-12 overflow-hidden bg-[#0a0e1a] text-white">
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-72 bg-gradient-to-r from-primary/30 via-violet-500/20 to-[#a2e435]/20 blur-3xl" />
        <div className="container relative grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={150} height={29} className="brightness-0 invert" />
            <p className="mt-4 max-w-xs text-sm text-white/60">Turn Google Maps into a pipeline of enriched, ready-to-pitch leads.</p>
            <div className="mt-6">
              <GoogleSignInButton size="sm" variant="secondary" className="rounded-full">Start free with Google</GoogleSignInButton>
            </div>
          </div>
          <div>
            <div className="mb-4 text-sm font-semibold">Pages</div>
            <ul className="space-y-2.5 text-sm text-white/60">
              {NAV.map((n) => <li key={n.href}><a href={n.href} className="transition-colors hover:text-white">{n.label}</a></li>)}
            </ul>
          </div>
          <div>
            <div className="mb-4 text-sm font-semibold">Social</div>
            <ul className="space-y-2.5 text-sm text-white/60">
              <li><a href="#" className="transition-colors hover:text-white">X (Twitter)</a></li>
              <li><a href="#" className="transition-colors hover:text-white">LinkedIn</a></li>
              <li><a href="#" className="transition-colors hover:text-white">Dribbble</a></li>
            </ul>
          </div>
        </div>
        {/* Giant wordmark, fading into the page */}
        <div className="pointer-events-none relative select-none">
          <div className="container">
            <div className="font-heading bg-gradient-to-b from-white/[0.12] to-white/[0.01] bg-clip-text text-center text-[19vw] font-bold leading-[0.78] tracking-tight text-transparent">LeadsFunda</div>
          </div>
        </div>
        <div className="relative border-t border-white/10">
          <div className="container flex flex-col items-center justify-between gap-3 py-6 text-sm text-white/50 sm:flex-row">
            <span>© {new Date().getFullYear()} LeadsFunda. All rights reserved.</span>
            <span>Built for people who actually outreach.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
