"use client";
import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Scale, ChevronDown, Menu, X, ArrowLeft } from "lucide-react";
import { GoogleSignInButton } from "../components/GoogleSignInButton";

const HATCH =
  "[background-image:repeating-linear-gradient(45deg,hsl(var(--foreground)/0.022)_0,hsl(var(--foreground)/0.022)_1px,transparent_1px,transparent_11px)]";

const NAV = [
  { href: "/#about", label: "About" },
  { href: "/#features", label: "Features" },
  { href: "/#reviews", label: "Reviews" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

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

export default function TermsPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className={`lf relative min-h-screen overflow-x-clip bg-background text-foreground ${HATCH}`}>
      {/* Ambient blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-48 top-40 h-[30rem] w-[30rem] rounded-full bg-violet-400/10 blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-3 z-40 px-4">
        <div className="container max-w-7xl mx-auto">
          <div className="flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 pl-5 shadow-sm backdrop-blur-xl">
            <Link href="/" className="flex items-center">
              <Logo />
            </Link>
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 text-sm font-medium md:flex">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{n.label}</a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <GoogleSignInButton size="sm" className="lf-cta rounded-xl hidden sm:inline-flex">Get started</GoogleSignInButton>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground md:hidden hover:bg-muted transition-colors"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Mobile navigation */}
          {mobileMenuOpen && (
            <div className="absolute left-0 right-0 top-16 z-50 rounded-2xl border border-border/75 bg-background/95 p-4 shadow-xl backdrop-blur-xl md:hidden">
              <nav className="flex flex-col gap-1.5">
                {NAV.map((n) => (
                  <a
                    key={n.href}
                    href={n.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {n.label}
                  </a>
                ))}
                <div className="mt-2 border-t border-border/60 pt-3">
                  <GoogleSignInButton size="lg" className="w-full rounded-xl">Get started</GoogleSignInButton>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-4 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-primary hover:underline mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="mb-10 text-center sm:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground/70 shadow-sm mb-4">
            <Scale className="h-3.5 w-3.5 text-primary" /> Legal Framework
          </span>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Terms of Service</h1>
          <p className="mt-3 text-muted-foreground">Last updated: June 23, 2026</p>
        </div>

        <div className="space-y-10 rounded-[2rem] border border-border bg-card p-6 sm:p-10 shadow-sm">
          
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">1</span>
              Acceptance of Terms
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              By accessing or using LeadsFunda, you agree to comply with and be bound by these Terms of Service. These terms govern your use of our Google Maps scraping, enrichment, and verification services. If you do not agree to these terms, please do not use the platform.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">2</span>
              B2B Service Restrictions
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              LeadsFunda is strictly a <strong>B2B (Business-to-Business)</strong> SaaS platform. Our features and database are optimized solely for business-to-business prospecting, market research, and corporate lead enrichment. You agree not to use the service for consumer (B2C) targeting or personal purposes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">3</span>
              Free Trial and Starter Credits
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We offer a <strong>Free Trial</strong> package to allow users to evaluate the platform before subscribing. Upon signing in with Google, you receive free starter credits to find, preview, and export a limited number of leads. No credit card is required to sign up for the free trial.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">4</span>
              Targeted Prospecting & Scope
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              LeadsFunda provides tools for highly <strong>Targeted</strong> prospecting. You can filter maps listings by rating, reviews, website availability, and other criteria. You agree to use these filters in good faith to compile targeted outreach lists. Bulk scraping without specific target niches is prohibited.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">5</span>
              Worldwide Database Access
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Our scraper operates on a <strong>Worldwide</strong> basis. You can generate lists of leads across any location globally where Google Maps listings are publicly available. However, you are solely responsible for compliance with regional data protection rules (such as GDPR in Europe) governing direct outreach to contacts within specific countries.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">6</span>
              99% Email Data Accuracy Target
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              While we utilize advanced Chrome-based crawlers to retrieve and verify emails, data on the web shifts rapidly. We target a <strong>99% email data accuracy</strong> threshold for our verification system. However, all leads are provided on an "as-is" and "as-available" basis. LeadsFunda does not guarantee or warrant 100% deliverability or success rates for email campaigns using data retrieved from the service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">7</span>
              Account Usage & Restrictions
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You may not abuse our server infrastructure or API credits. Account sharing is prohibited. If we detect abnormal activities (e.g. automated bot scraping of our dashboard or credit manipulation), we reserve the right to terminate your account immediately without refund.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 pb-6">
        <div className={`container overflow-hidden bg-transparent md:bg-card border-none md:border md:rounded-[2rem] md:shadow-sm ${HATCH}`}>
          <div className="grid grid-cols-2 gap-8 p-6 md:p-10 md:grid-cols-5">
            <div className="col-span-2 md:col-span-2">
              <Logo />
              <p className="mt-4 max-w-xs text-sm text-muted-foreground">Turn Google Maps into a pipeline of enriched, ready-to-pitch B2B leads with 99% email data accuracy.</p>
              <div className="mt-6"><GoogleSignInButton size="sm" className="lf-cta rounded-xl">Start free with Google</GoogleSignInButton></div>
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
                <li><Link href="/terms" className="transition-colors hover:text-foreground">Terms of Service</Link></li>
                <li><Link href="/privacy" className="transition-colors hover:text-foreground">Privacy Policy</Link></li>
                <li><Link href="/can-spam" className="transition-colors hover:text-foreground">CAN-SPAM Policy</Link></li>
              </ul>
            </div>
            <div>
              <div className="mb-4 text-sm font-semibold text-foreground">Support</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><Link href="/contact" className="transition-colors hover:text-foreground">Contact Us</Link></li>
                <li><a href="mailto:support@leadsfunda.com" className="transition-colors hover:text-foreground">Email Support</a></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-1">
              <div className="mb-4 text-sm font-semibold text-foreground">Social</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="https://x.com/leadsfunda" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">X (Twitter)</a></li>
                <li><a href="https://instagram.com/leadsfunda" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Instagram</a></li>
                <li><a href="https://facebook.com/leadsfunda" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Facebook</a></li>
                <li><a href="#" className="transition-colors hover:text-foreground">LinkedIn</a></li>
              </ul>
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
