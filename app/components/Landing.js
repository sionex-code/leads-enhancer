"use client";
import { useState } from "react";
import Image from "next/image";
import {
  MapPin,
  Mail,
  Activity,
  ListChecks,
  ShieldCheck,
  Zap,
  Check,
  Search,
  Star,
  Globe2,
  MessageCircle,
  ArrowRight,
  Sparkles,
  Cloud,
  Lock,
  Plus,
  Minus,
} from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button } from "./ui/button";

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

const TESTIMONIALS = [
  { name: "Marcus D.", role: "Agency owner", body: "Pulled 1,200 plumbers in an afternoon and half had no website — instant pitch list." },
  { name: "Priya N.", role: "Freelance SDR", body: "The email + WhatsApp enrichment sold me. My list is ready to outreach the second it lands." },
  { name: "Tom R.", role: "Web designer", body: "Website health scoring tells me exactly who to call first. Game-changer for cold outreach." },
  { name: "Lena K.", role: "Growth marketer", body: "I cancelled three tools after switching. Scrape, enrich and audit all in one tab." },
  { name: "Sergio A.", role: "Lead-gen", body: "Runs in the cloud, so I close the laptop and the leads are waiting when I'm back." },
  { name: "Dana W.", role: "Sales ops", body: "Cleanest CSV exports I've used — straight into my CRM, zero cleanup." },
];

const PLANS = [
  { id: "p19", name: "Starter", price: "19", quota: "5,000 credits / month", popular: false,
    perks: ["5,000 credits / mo", "Email + social enrichment", "Website health checks", "CSV export"] },
  { id: "p35", name: "Growth", price: "35", quota: "50,000 credits / month", popular: true,
    perks: ["50,000 credits / mo", "Everything in Starter", "Priority in the job queue", "WhatsApp checks"] },
  { id: "p49", name: "Scale", price: "49", quota: "Unlimited credits / month", popular: false,
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

const AVATARS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500", "bg-orange-500", "bg-rose-500",
];

function Stars() {
  return (
    <div className="flex items-center gap-0.5 text-amber-400">
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
    </div>
  );
}

// Mini leads-table mock for the first split feature card.
function MiniLeads() {
  const rows = [
    { n: "Lone Star Plumbing", s: 38, c: "text-rose-600" },
    { n: "Hill Country HVAC", s: 72, c: "text-amber-600" },
    { n: "Capital Roofing Co.", s: 21, c: "text-rose-600" },
    { n: "Barton Electric", s: 64, c: "text-amber-600" },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="h-3 w-3" /> plumber in Austin TX
        <span className="ml-auto rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600">1,284 found</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="truncate font-medium text-foreground">{r.n}</span>
            <span className={`ml-auto font-semibold ${r.c}`}>{r.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mini enrichment / contact mock for the second split feature card.
function MiniEnrich() {
  const rows = [
    { n: "office@hillcountry.com", wa: true },
    { n: "team@bartonelectric.com", wa: true },
    { n: "hello@lonestarplumb.com", wa: false },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="h-3 w-3 text-violet-600" /> Enriched contacts
        <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">912 emails</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="truncate font-medium text-foreground">{r.n}</span>
            {r.wa && <MessageCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqItem({ q, a, open, onClick }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <button onClick={onClick} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="font-heading text-base font-semibold text-foreground">{q}</span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
      </button>
      {open && <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{a}</p>}
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
      <header className="sticky top-3 z-30 px-4">
        <div className="container">
          <div className="flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 pl-5 shadow-sm backdrop-blur-xl">
            <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={140} height={27} priority />
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="transition-colors hover:text-foreground">{n.label}</a>
              ))}
            </nav>
            <GoogleSignInButton size="sm" className="rounded-full">Get started</GoogleSignInButton>
          </div>
        </div>
      </header>

      {/* Hero — centered, then the product window with the video */}
      <section className="relative px-4">
        <div className="container flex flex-col items-center pb-10 pt-16 text-center sm:pt-24">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Google Maps lead generation, on autopilot
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
            <GoogleSignInButton size="lg" className="rounded-full px-7">Start free with Google</GoogleSignInButton>
            <Button asChild variant="outline" size="lg" className="rounded-full px-7">
              <a href="#how">See how it works <ArrowRight className="h-4 w-4" /></a>
            </Button>
          </div>
          {/* Trust row: stacked avatars + rating */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <div className="flex -space-x-2.5">
              {AVATARS.map((c, i) => (
                <span key={i} className={`h-8 w-8 rounded-full border-2 border-background ${c}`} />
              ))}
            </div>
            <span className="text-sm text-muted-foreground">Trusted by <span className="font-semibold text-foreground">2,400+</span> marketers</span>
            <span className="flex items-center gap-1.5"><Stars /> <span className="text-sm font-semibold text-foreground">5.0</span></span>
          </div>
        </div>

        {/* Product window — the hero video lives here */}
        <div className="container relative max-w-5xl pb-8">
          <div className="pointer-events-none absolute -inset-x-10 -top-6 bottom-10 -z-10 rounded-[3rem] bg-gradient-to-tr from-primary/25 via-violet-400/20 to-[#a2e435]/25 blur-3xl" />
          <div className="overflow-hidden rounded-[1.6rem] border border-border bg-card shadow-2xl shadow-primary/10">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-rose-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
              <div className="mx-auto flex items-center gap-2 rounded-full bg-background/70 px-4 py-1 text-xs text-muted-foreground">
                <Globe2 className="h-3 w-3" /> app.leadsfunda.com
              </div>
            </div>
            <video
              className="block aspect-video w-full bg-muted object-cover"
              src="/leadsfunda-hyperframes.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
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

      {/* Split features with mini-UI mockups */}
      <section className="container space-y-6 py-20">
        <div className="mx-auto mb-4 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">Features</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">From raw Maps listing to ready-to-pitch lead</h2>
          <p className="mt-3 text-muted-foreground">Scrape, enrich, audit and organize — without stitching together five different tools.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="grid items-center gap-6 rounded-3xl border border-border bg-card p-7 sm:grid-cols-2">
            <div>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600"><Search className="h-5 w-5" /></div>
              <h3 className="font-heading text-xl font-bold">Find who needs you</h3>
              <p className="mt-2 text-sm text-muted-foreground">Every business in a niche, scored by website health so the prospects worth calling rise to the top.</p>
            </div>
            <MiniLeads />
          </div>
          <div className="grid items-center gap-6 rounded-3xl border border-border bg-card p-7 sm:grid-cols-2">
            <div>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600"><Mail className="h-5 w-5" /></div>
              <h3 className="font-heading text-xl font-bold">Ready to outreach</h3>
              <p className="mt-2 text-sm text-muted-foreground">Emails, socials and WhatsApp pulled from each site, so your list is sendable the moment it lands.</p>
            </div>
            <MiniEnrich />
          </div>
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
          {FEATURES.map(({ icon: Icon, title, body, tile }) => (
            <div key={title} className="group rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
              <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${tile}`}><Icon className="h-5 w-5" /></div>
              <h3 className="font-heading text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
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
            {STEPS.map(({ n, title, body }) => (
              <div key={n} className="relative overflow-hidden rounded-3xl border border-border bg-card p-7">
                <span className="font-heading block bg-gradient-to-br from-primary to-violet-500 bg-clip-text text-5xl font-bold text-transparent">{n}</span>
                <h3 className="font-heading mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="container py-16">
        <div className="grid grid-cols-2 gap-6 rounded-3xl border border-border bg-gradient-to-br from-card to-muted/40 p-10 text-center md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.l}>
              <div className="font-heading text-3xl font-bold text-foreground sm:text-4xl">{s.v}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials wall */}
      <section className="container py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">Testimonials</span>
          <h2 className="font-heading mt-2 text-3xl font-bold tracking-tight sm:text-4xl">What our users are saying</h2>
          <p className="mt-3 text-muted-foreground">Real feedback from people who run outreach every day.</p>
        </div>
        <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
          {TESTIMONIALS.map((t, i) => (
            <div key={t.name} className="break-inside-avoid rounded-3xl border border-border bg-card p-6">
              <Stars />
              <p className="mt-3 text-sm leading-relaxed text-foreground">“{t.body}”</p>
              <div className="mt-4 flex items-center gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${AVATARS[i % AVATARS.length]}`}>{t.name[0]}</span>
                <div>
                  <div className="text-sm font-semibold text-foreground">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
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
          {PLANS.map((plan) => (
            <div key={plan.id} className={`relative flex flex-col rounded-3xl border bg-card p-7 ${plan.popular ? "border-primary shadow-2xl shadow-primary/10 lg:-mt-3 lg:mb-3" : "border-border"}`}>
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">Most popular</span>
              )}
              <div className="text-sm font-medium text-muted-foreground">{plan.name}</div>
              <div className="mt-2 flex items-end gap-1">
                <span className="font-heading text-5xl font-bold">${plan.price}</span>
                <span className="mb-1.5 text-sm text-muted-foreground">/ month</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{plan.quota}</div>
              {checkout[plan.id] ? (
                <Button asChild className="mt-6 w-full rounded-full" variant={plan.popular ? "default" : "outline"}>
                  <a href={checkout[plan.id]} target="_blank" rel="noreferrer">Get started</a>
                </Button>
              ) : (
                <GoogleSignInButton className="mt-6 w-full rounded-full" variant={plan.popular ? "default" : "outline"}>Get started</GoogleSignInButton>
              )}
              <ul className="mt-6 space-y-3 text-sm">
                {plan.perks.map((p) => (
                  <li key={p} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#a2e435]/30 text-[#3a6b00]"><Check className="h-3 w-3" /></span>
                    <span className="text-muted-foreground">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
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
            <GoogleSignInButton size="lg" variant="secondary" className="rounded-full px-7">Start free with Google</GoogleSignInButton>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="container grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={140} height={27} />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">Turn Google Maps into a pipeline of enriched, ready-to-pitch leads.</p>
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold text-foreground">Pages</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {NAV.map((n) => <li key={n.href}><a href={n.href} className="transition-colors hover:text-foreground">{n.label}</a></li>)}
            </ul>
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold text-foreground">Get started</div>
            <GoogleSignInButton size="sm" className="rounded-full">Sign in with Google</GoogleSignInButton>
          </div>
        </div>
        <div className="border-t border-border/60">
          <div className="container py-6 text-center text-sm text-muted-foreground">© {new Date().getFullYear()} LeadsFunda. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
