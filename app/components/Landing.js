"use client";
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
} from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";

const FEATURES = [
  { icon: MapPin, title: "Scrape Google Maps", body: "Pull business name, phone, website, address, rating, reviews and hours for any niche + location. Fast, deduped, resumable." },
  { icon: Mail, title: "Enrich contacts", body: "Crawl each lead's site for emails, social profiles and WhatsApp so your list is ready to outreach the moment it lands." },
  { icon: Activity, title: "Website health", body: "Real-Chrome audits, HTTP status and chatbot detection to surface prospects whose sites clearly need work." },
  { icon: ListChecks, title: "Workflow built in", body: "Watchlists, email decisions, outreach status and notes keep your pipeline organized from scrape to closed." },
  { icon: Zap, title: "Runs in the cloud", body: "Jobs run on our servers and queue automatically. Start a scrape, close the tab, and get notified when it's done." },
  { icon: ShieldCheck, title: "Your data, isolated", body: "Every account's leads and projects are private and protected. Never shared, never resold." },
];

const STEPS = [
  { n: "01", icon: Search, title: "Pick a niche & city", body: "Choose a service and location, or paste your own Maps query. Set how many leads you want." },
  { n: "02", icon: Zap, title: "We scrape & enrich", body: "We pull every business, then crawl their sites for emails, socials and WhatsApp, automatically." },
  { n: "03", icon: ListChecks, title: "Work the pipeline", body: "Filter, audit websites, mark outreach status and export a clean CSV ready for your campaigns." },
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
  { q: "Do I need to install anything?", a: "No. LeadsFunda runs entirely in the cloud. Sign in with Google, start a scrape, and your leads appear in the dashboard, even if you close the tab." },
  { q: "Where do the leads come from?", a: "Public Google Maps business listings for the niche and location you choose. We then visit each business's own website to enrich emails and social profiles." },
  { q: "Can I cancel anytime?", a: "Yes. Plans are monthly and managed through Whop. Upgrade, downgrade or cancel whenever you like. No contracts." },
  { q: "What counts as a lead?", a: "Each unique business captured and enriched counts once against your monthly quota. Re-checking or auditing an existing lead is free." },
];

function StatPill({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-foreground sm:text-3xl">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// Faux app-window preview so the hero shows the product without a screenshot.
function DashboardPreview() {
  const rows = [
    { name: "Lone Star Plumbing", city: "Austin, TX", email: "hi@lonestar...", score: 38, wa: true },
    { name: "Hill Country HVAC", city: "Austin, TX", email: "office@hch...", score: 72, wa: false },
    { name: "Capital Roofing Co.", city: "Austin, TX", email: "no email", score: 21, wa: true },
    { name: "Barton Electric", city: "Austin, TX", email: "team@barton...", score: 64, wa: true },
  ];
  const scoreColor = (s) => (s >= 90 ? "text-emerald-600" : s >= 50 ? "text-amber-600" : "text-red-600");
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-primary/10">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-500/70" />
        <span className="h-3 w-3 rounded-full bg-amber-500/70" />
        <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
        <div className="ml-3 flex items-center gap-2 rounded-md bg-background/60 px-3 py-1 text-xs text-muted-foreground">
          <Search className="h-3 w-3" /> plumber in Austin TX
        </div>
        <Badge className="ml-auto gap-1 text-[10px]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Scraping</Badge>
      </div>
      <div className="grid grid-cols-3 gap-px bg-border/60 text-center text-xs">
        {[["1,284", "Leads"], ["912", "Emails"], ["318", "Need a site fix"]].map(([v, l]) => (
          <div key={l} className="bg-card px-2 py-3">
            <div className="text-base font-bold text-foreground">{v}</div>
            <div className="text-[11px] text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{r.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{r.city} · {r.email}</div>
            </div>
            {r.wa && <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />}
            <span className={`text-xs font-semibold ${scoreColor(r.score)}`}>{r.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing({ checkout = {} }) {
  return (
    <div className="lf min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={150} height={29} priority />
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </nav>
          <GoogleSignInButton variant="outline" size="sm">Sign in</GoogleSignInButton>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_-10%,hsl(230_100%_60%/0.20),transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="container grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div className="flex flex-col items-start text-left">
            <Badge variant="outline" className="mb-5 gap-1.5"><Zap className="h-3 w-3 text-primary" /> Google Maps lead generation, on autopilot</Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl xl:text-6xl">
              Turn Google Maps into a <span className="bg-gradient-to-r from-primary to-sky-500 bg-clip-text text-transparent">pipeline of leads</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Scrape any niche, enrich every lead with emails, socials and WhatsApp, and spot prospects whose websites need help, all from one dashboard.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <GoogleSignInButton size="lg">Start free with Google</GoogleSignInButton>
              <Button asChild variant="outline" size="lg"><a href="#pricing">See pricing <ArrowRight className="h-4 w-4" /></a></Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">No credit card to sign in · Pick a plan when you're ready</p>
            <div className="mt-10 flex w-full max-w-md items-center justify-between gap-4 border-t border-border/60 pt-6">
              <StatPill value="2.4M+" label="Leads scraped" />
              <StatPill value="190+" label="Niches covered" />
              <StatPill value="9 socials" label="Enriched per lead" />
            </div>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-3xl bg-primary/10 blur-2xl" />
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y border-border/60 bg-card/30">
        <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-primary" /> Real-Chrome website audits</span>
          <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /> WhatsApp detection</span>
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /> Email + social enrichment</span>
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Private &amp; isolated data</span>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4">Everything in one place</Badge>
          <h2 className="text-3xl font-bold tracking-tight">From raw Maps listing to ready-to-pitch lead</h2>
          <p className="mt-3 text-muted-foreground">Scrape, enrich, audit and organize, without stitching together five different tools.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="bg-card/60 transition-colors hover:border-primary/40 hover:bg-card">
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon className="h-5 w-5" /></div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border/60 bg-card/20 py-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <Badge variant="secondary" className="mb-4">How it works</Badge>
            <h2 className="text-3xl font-bold tracking-tight">Three steps to a full pipeline</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map(({ n, icon: Icon, title, body }) => (
              <Card key={n} className="relative overflow-hidden bg-card/60">
                <CardHeader>
                  <span className="mb-3 text-5xl font-bold text-primary/15">{n}</span>
                  <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon className="h-5 w-5" /></div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="container py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4">Pricing</Badge>
          <h2 className="text-3xl font-bold tracking-tight">Simple, credit-based pricing</h2>
          <p className="mt-3 text-muted-foreground">Pick a monthly credit pack. Upgrade or cancel anytime.</p>
        </div>
        <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.id} className={plan.popular ? "relative border-primary shadow-lg shadow-primary/10 lg:-mt-3 lg:mb-3" : "relative"}>
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1"><Star className="h-3 w-3" /> Most popular</Badge>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <CardDescription>{plan.quota}</CardDescription>
                <div className="mt-2 flex items-end gap-1">
                  <span className="text-4xl font-bold">${plan.price}</span>
                  <span className="mb-1 text-sm text-muted-foreground">/month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {plan.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{p}</span></li>
                  ))}
                </ul>
                {checkout[plan.id] ? (
                  <Button asChild className="w-full" variant={plan.popular ? "default" : "outline"}>
                    <a href={checkout[plan.id]} target="_blank" rel="noreferrer">Get {plan.name}</a>
                  </Button>
                ) : (
                  <GoogleSignInButton className="w-full" variant={plan.popular ? "default" : "outline"}>Get {plan.name}</GoogleSignInButton>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Payments are processed securely by Whop. Sign in with Google first, then subscribe.</p>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border/60 py-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <Badge variant="secondary" className="mb-4">FAQ</Badge>
            <h2 className="text-3xl font-bold tracking-tight">Questions, answered</h2>
          </div>
          <div className="mx-auto grid max-w-3xl gap-4">
            {FAQ.map(({ q, a }) => (
              <Card key={q} className="bg-card/60">
                <CardHeader>
                  <CardTitle className="text-base">{q}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">{a}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container py-16">
        <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/15 to-transparent">
          <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
            <h2 className="max-w-xl text-2xl font-bold sm:text-3xl">Ready to build your lead list?</h2>
            <p className="max-w-lg text-muted-foreground">Sign in with Google and run your first scrape in minutes.</p>
            <GoogleSignInButton size="lg">Start free with Google</GoogleSignInButton>
          </CardContent>
        </Card>
      </section>

      <footer className="border-t border-border/60">
        <div className="container flex flex-col items-center justify-between gap-4 py-8 text-sm text-muted-foreground sm:flex-row">
          <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={120} height={23} />
          <span>© {new Date().getFullYear()} LeadsFunda. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
