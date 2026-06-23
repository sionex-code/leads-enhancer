"use client";
import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, Lock, Eye, Menu, X, ArrowLeft } from "lucide-react";
import { GoogleSignInButton } from "../components/GoogleSignInButton";

const HATCH =
  "[background-image:repeating-linear-gradient(45deg,hsl(var(--foreground)/0.022)_0,hsl(var(--foreground)/0.022)_1px,transparent_1px,transparent_11px)]";

export default function PrivacyPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className={`lf relative min-h-screen overflow-x-clip bg-[#0b0f1d] text-slate-200 ${HATCH}`}>
      {/* Ambient blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-48 top-40 h-[30rem] w-[30rem] rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-3 z-40 px-4">
        <div className="container max-w-7xl mx-auto">
          <div className="flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 pl-5 shadow-sm backdrop-blur-xl">
            <Link href="/" className="flex items-center">
              <Image
                src="/brand/leadsfunda-white.svg"
                alt="LeadsFunda"
                width={145}
                height={28}
                priority
                className="h-[20px] w-auto sm:h-[28px] sm:w-auto"
              />
            </Link>
            <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 text-sm font-medium md:flex">
              <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">Home</Link>
              <Link href="/terms" className="text-muted-foreground transition-colors hover:text-foreground">Terms</Link>
              <Link href="/can-spam" className="text-muted-foreground transition-colors hover:text-foreground">CAN-SPAM</Link>
              <Link href="/contact" className="text-muted-foreground transition-colors hover:text-foreground">Contact</Link>
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
            <div className="absolute left-4 right-4 top-16 z-50 rounded-2xl border border-border/75 bg-[#0b0f1d]/95 p-4 shadow-xl backdrop-blur-xl md:hidden">
              <nav className="flex flex-col gap-1.5">
                <Link href="/" onClick={() => setMobileMenuOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Home</Link>
                <Link href="/terms" onClick={() => setMobileMenuOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Terms of Service</Link>
                <Link href="/can-spam" onClick={() => setMobileMenuOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">CAN-SPAM Policy</Link>
                <Link href="/contact" onClick={() => setMobileMenuOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Contact Us</Link>
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-primary shadow-sm mb-4">
            <ShieldCheck className="h-3.5 w-3.5" /> Data Security
          </span>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-white">Privacy Policy</h1>
          <p className="mt-3 text-muted-foreground">Last updated: June 23, 2026</p>
        </div>

        <div className="space-y-10 rounded-[2rem] border border-border bg-[#0f172a]/60 p-6 sm:p-10 backdrop-blur-sm">
          
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">
                <Lock className="h-4 w-4" />
              </span>
              Your Privacy is Our Priority
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              At LeadsFunda, we hold the principle of <strong>Your Privacy</strong> above all. We are committed to safeguarding your account information, your search history, and the lead lists you generate. Unlike other database providers, your lists are fully isolated and protected from third-party lookup.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">
                <Eye className="h-4 w-4" />
              </span>
              No Selling or Sharing of Lead Data
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              We operate under a strict zero-sharing policy: <strong>we never sell, rent, or lease the lead lists</strong> you scrape or compile on the platform. All research, search queries, filters, and exported CSV data belong exclusively to you, and are isolated in your secure project workspace database.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">3</span>
              Information We Collect
            </h2>
            <div className="text-sm leading-relaxed text-slate-300 space-y-2">
              <p>To provide and improve our service, we collect the following:</p>
              <ul className="list-disc list-inside pl-2 space-y-1">
                <li><strong>Account details:</strong> Google profile information (name, email, avatar) when you log in.</li>
                <li><strong>Usage log data:</strong> Scrapes conducted, dashboard filter configurations, and export histories for billing and credit management.</li>
                <li><strong>Payment data:</strong> Processed securely via our merchant provider (Whop). We do not store or access your credit card details.</li>
              </ul>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">4</span>
              How We Use Information
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Your information is used strictly to authenticate your account, maintain your workspaces, allocate credits, process subscriptions, and prevent fraud. We do not use your search keywords to train public models or populate other users' search indexes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">5</span>
              Data Protection and GDPR/CCPA
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              We comply with applicable global privacy standards. Because LeadsFunda scrapes public B2B business details, users exporting this data are designated as the Data Controllers of such lists. You must ensure your marketing and sales activities comply with local GDPR, CCPA, and privacy laws.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">6</span>
              Changes to this Policy
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              We may update this Privacy Policy from time to time to reflect operational or regulatory changes. Any updates will be posted here with an updated revision date.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 pb-6 mt-12 border-t border-border/40 pt-10">
        <div className="container max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} LeadsFunda. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/can-spam" className="hover:text-foreground">CAN-SPAM</Link>
            <Link href="/contact" className="hover:text-foreground">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
