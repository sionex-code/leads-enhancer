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
  Sparkles,
} from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";

// Each feature carries its own accent so the grid reads "colorful" while the brand
// blue stays primary. Classes are written out in full so Tailwind's JIT keeps them.
const FEATURES = [
  { icon: MapPin, tile: "bg-blue-500/10 text-blue-600", title: "Scrape Google Maps", body: "Pull business name, phone, website, address, rating, reviews and hours for any niche + location. Fast, deduped, resumable." },
  { icon: Mail, tile: "bg-violet-500/10 text-violet-600", title: "Enrich contacts", body: "Crawl each lead's site for emails, social profiles and WhatsApp so your list is ready to outreach the moment it lands." },
  { icon: Activity, tile: "bg-emerald-500/10 text-emerald-600", title: "Website health", body: "Real-Chrome audits, HTTP status and chatbot detection to surface prospects whose sites clearly need work." },
  { icon: ListChecks, tile: "bg-orange-500/10 text-orange-600", title: "Workflow built in", body: "Watchlists, email decisions, outreach status and notes keep your pipeline organized from scrape to closed." },
  { icon: Zap, tile: "bg-cyan-500/10 text-cyan-600", title: "Runs in the cloud", body: "Jobs run on our servers and queue automatically. Start a scrape, close the tab, and get notified when it's done." },
  { icon: ShieldCheck, tile: "bg-rose-500/10 text-rose-600", title: "Your data, isolated", body: "Every account's leads and projects are private and protected. Never shared, never resold." },
];

const STEPS = [
  { n: "01", icon: Search, tile: "bg-violet-500/10 text-violet-600", ring: "from-violet-500/40", title: "Pick a niche & city", body: "Choose a service and location, or paste your own Maps query. Set how many leads you want." },
  { n: "02", icon: Zap, tile: "bg-blue-500/10 text-blue-600", ring: "from-blue-500/40", title: "We scrape & enrich", body: "We pull every business, then crawl their sites for emails, socials and WhatsApp, automatically." },
  { n: "03", icon: ListChecks, tile: "bg-emerald-500/10 text-emerald-600", ring: "from-emerald-500/40", title: "Work the pipeline", body: "Filter, audit websites, mark outreach status and export a clean CSV ready for your campaigns." },
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
  { q: "What counts as a credit?", a: "Finding a lead costs 1 credit; a quick audit 3, a chatbot scan 5, and a full website report 10. Re-checking a lead you already own is free." },
];

function StatPill({ value, label }) {
  return (
    <div className="text-center">
      <div className="font-heading text-2xl font-bold text-foreground sm:text-3xl">{value}</div>
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
  const scoreColor = (s) => (s >= 90 ? "text-emerald-600" : s >= 50 ? "text-amber-600" : "text-rose-600");
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-rose-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-emerald-400" />
        <div className="ml-3 flex items-center gap-2 rounded-md bg-background/60 px-3 py-1 text-xs text-muted-foreground">
          <Search className="h-3 w-3" /> plumber in Austin TX
        </div>
        <Badge className="ml-auto gap-1 text-[10px]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Scraping</Badge>
      </div>
      <div className="grid grid-cols-3 gap-px bg-border/60 text-center text-xs">
        {[["1,284", "Leads", "text-blue-600"], ["912", "Emails", "text-violet-600"], ["318", "Need a fix", "text-orange-600"]].map(([v, l, c]) => (
          <div key={l} className="bg-card px-2 py-3">
            <div className={`font-heading text-base font-bold ${c}`}>{v}</div>
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
    <div className="lf relative min-h-screen overflow-x-clip bg-background text-foreground">
      {/* Colorful ambient background blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-40 top-24 h-[26rem] w-[26rem] rounded-full bg-violet-400/20 blur-3xl" />
        <div className="absolute left-1/3 top-[42rem] h-[24rem] w-[24rem] rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute -left-24 top-[70rem] h-[22rem] w-[22rem] rounded-full bg-emerald-300/20 blur-3xl" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
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
      <section className="relative">
        <div className="container grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div className="flex flex-col items-start text-left">
            <Badge variant="outline" className="mb-5 gap-1.5 border-primary/30 bg-primary/5 text-primary"><Sparkles className="h-3 w-3" /> Google Maps lead generation, on autopilot</Badge>
            <h1 className="font-heading text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">
              Turn Google Maps into a{" "}
              <span className="bg-gradient-to-r from-primary via-violet-500 to-cyan-500 bg-clip-text text-transparent">pipeline of leads</span>
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
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/20 via-violet-400/15 to-cyan-300/20 blur-2xl" />
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y border-border/60 bg-card/40 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-blue-600" /> Real-Chrome website audits</span>
          <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp detection</span>
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-violet-600" /> Email + social enrichment</span>
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-rose-600" /> Private &amp; isolated data</span>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4">Everything in one place</Badge>
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">From raw Maps listing to ready-to-pitch lead</h2>
          <p className="mt-3 text-muted-foreground">Scrape, enrich, audit and organize, without stitching together five different tools.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, tile }) => (
            <Card key={title} className="group bg-card/70 backdrop-blur transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
              <CardHeader>
                <div className={`mb-2 flex h-11 w-11 items-center justify-center rounded-xl ${tile}`}><Icon className="h-5 w-5" /></div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border/60 bg-card/30 py-20">
        <div className="container">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <Badge variant="secondary" className="mb-4">How it works</Badge>
            <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Three steps to a full pipeline</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map(({ n, icon: Icon, title, body, tile, ring }) => (
              <Card key={n} className="relative overflow-hidden bg-card/70 backdrop-blur">
                <div className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${ring} to-transparent blur-2xl`} />
                <CardHeader>
                  <span className="font-heading mb-3 bg-gradient-to-br from-foreground/15 to-foreground/5 bg-clip-text text-5xl font-bold text-transparent">{n}</span>
                  <div className={`mb-1 flex h-11 w-11 items-center justify-center rounded-xl ${tile}`}><Icon className="h-5 w-5" /></div>
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
          <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Simple, credit-based pricing</h2>
          <p className="mt-3 text-muted-foreground">Pick a monthly credit pack. Upgrade or cancel anytime.</p>
        </div>
        <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.id} className={plan.popular
              ? "relative border-primary/50 shadow-xl shadow-primary/10 lg:-mt-3 lg:mb-3"
              : "relative bg-card/70 backdrop-blur"}>
              {plan.popular && (
                <>
                  <div className="pointer-events-none absolute -inset-px -z-10 rounded-[inherit] bg-gradient-to-b from-primary/40 via-violet-400/30 to-transparent" />
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1"><Star className="h-3 w-3" /> Most popular</Badge>
                </>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <CardDescription>{plan.quota}</CardDescription>
                <div className="mt-2 flex items-end gap-1">
                  <span className="font-heading text-4xl font-bold">${plan.price}</span>
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
            <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">Questions, answered</h2>
          </div>
          <div className="mx-auto grid max-w-3xl gap-4">
            {FAQ.map(({ q, a }) => (
              <Card key={q} className="bg-card/70 backdrop-blur">
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
        <Card className="relative overflow-hidden border-transparent bg-gradient-to-br from-primary via-blue-600 to-violet-600 text-white">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-cyan-300/20 blur-2xl" />
          <CardContent className="flex flex-col items-center gap-5 py-14 text-center">
            <h2 className="font-heading max-w-xl text-2xl font-bold sm:text-3xl">Ready to build your lead list?</h2>
            <p className="max-w-lg text-white/80">Sign in with Google and run your first scrape in minutes.</p>
            <GoogleSignInButton size="lg" variant="secondary">Start free with Google</GoogleSignInButton>
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
