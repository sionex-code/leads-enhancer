"use client";
import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, Lock, Eye, Menu, X, ArrowLeft } from "lucide-react";
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

export default function PrivacyPage() {
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
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Data Security
          </span>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
          <p className="mt-3 text-muted-foreground">Last updated: June 23, 2026</p>
        </div>

        <div className="space-y-10 rounded-[2rem] border border-border bg-card p-6 sm:p-10 shadow-sm">
          
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Lock className="h-4 w-4" />
              </span>
              Your Privacy is Our Priority
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              At LeadsFunda, we hold the principle of <strong>Your Privacy</strong> above all. We are committed to safeguarding your account information, your search history, and the lead lists you generate. Unlike other database providers, your lists are fully isolated and protected from third-party lookup.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Eye className="h-4 w-4" />
              </span>
              No Selling or Sharing of Lead Data
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We operate under a strict zero-sharing policy: <strong>we never sell, rent, or lease the lead lists</strong> you scrape or compile on the platform. All research, search queries, filters, and exported CSV data belong exclusively to you, and are isolated in your secure project workspace database.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">3</span>
              Information We Collect
            </h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-2">
              <p>To provide and improve our service, we collect the following:</p>
              <ul className="list-disc list-inside pl-2 space-y-1">
                <li><strong>Account details:</strong> Google profile information (name, email, avatar) when you log in.</li>
                <li><strong>Usage log data:</strong> Scrapes conducted, dashboard filter configurations, and export histories for billing and credit management.</li>
                <li><strong>Payment data:</strong> Processed securely via our merchant provider (Whop). We do not store or access your credit card details.</li>
              </ul>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">4</span>
              How We Use Information
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your information is used strictly to authenticate your account, maintain your workspaces, allocate credits, process subscriptions, and prevent fraud. We do not use your search keywords to train public models or populate other users' search indexes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">5</span>
              Data Protection and GDPR/CCPA
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We comply with applicable global privacy standards. Because LeadsFunda scrapes public B2B business details, users exporting this data are designated as the Data Controllers of such lists. You must ensure your marketing and sales activities comply with local GDPR, CCPA, and privacy laws.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">6</span>
              Changes to this Policy
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We may update this Privacy Policy from time to time to reflect operational or regulatory changes. Any updates will be posted here with an updated revision date.
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
