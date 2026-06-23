"use client";
import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShieldAlert, CheckCircle, Mail, AlertTriangle, Menu, X, ArrowLeft } from "lucide-react";
import { GoogleSignInButton } from "../components/GoogleSignInButton";

const HATCH =
  "[background-image:repeating-linear-gradient(45deg,hsl(var(--foreground)/0.022)_0,hsl(var(--foreground)/0.022)_1px,transparent_1px,transparent_11px)]";

export default function CanSpamPage() {
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
              <Link href="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">Privacy</Link>
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
                <Link href="/privacy" onClick={() => setMobileMenuOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Privacy Policy</Link>
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
            <ShieldAlert className="h-3.5 w-3.5" /> Compliance Guidelines
          </span>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-white">CAN-SPAM Policy</h1>
          <p className="mt-3 text-muted-foreground">Compliance guide and regulations for lead outreach campaigns.</p>
        </div>

        <div className="space-y-10 rounded-[2rem] border border-border bg-[#0f172a]/60 p-6 sm:p-10 backdrop-blur-sm">
          
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" />
              </span>
              Our Spam Policy
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              LeadsFunda mandates that all outreach conducted using emails harvested or verified from our system complies strictly with global anti-spam rules. We enforce a zero-tolerance <strong>Spam Policy</strong> for users who engage in unsolicited bulk harassment or list-selling. Failure to follow compliance rules will result in account suspension without refund.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#a2e435]/15 text-[#a2e435] text-sm font-semibold">✓</span>
              CAN-SPAM Act Rules for Outreach
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              If your business sends commercial emails to leads extracted from LeadsFunda, you must satisfy the requirements of the United States CAN-SPAM Act:
            </p>
            <div className="grid gap-4 mt-4 grid-cols-1 sm:grid-cols-2">
              <div className="border border-border p-4 rounded-xl bg-card/40">
                <h3 className="font-bold text-white text-sm">Don't Use Deceptive Headers</h3>
                <p className="text-xs text-muted-foreground mt-1">Your "From," "To," "Reply-To," and routing information must be accurate and identify the sender.</p>
              </div>
              <div className="border border-border p-4 rounded-xl bg-card/40">
                <h3 className="font-bold text-white text-sm">Don't Use Misleading Subjects</h3>
                <p className="text-xs text-muted-foreground mt-1">The subject line must reflect the actual content of the email and not trick the reader.</p>
              </div>
              <div className="border border-border p-4 rounded-xl bg-card/40">
                <h3 className="font-bold text-white text-sm">Include Your Physical Address</h3>
                <p className="text-xs text-muted-foreground mt-1">Your outreach emails must include a valid physical postal address or registered PO Box.</p>
              </div>
              <div className="border border-border p-4 rounded-xl bg-card/40">
                <h3 className="font-bold text-white text-sm">Provide a Clear Opt-Out</h3>
                <p className="text-xs text-muted-foreground mt-1">Include a clear link or instructions on how the recipient can opt-out of future emails.</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">3</span>
              Processing Opt-Out Requests
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Under CAN-SPAM rules, you must honor opt-out requests within <strong>10 business days</strong>. Any opt-out mechanism you provide must remain functional for at least 30 days after the email is sent. You cannot charge a fee, require the recipient to provide personal info, or make them take multiple steps to opt out.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">4</span>
              Direct B2B Outreach & Personal Data laws
            </h2>
            <p className="text-sm leading-relaxed text-slate-300">
              In countries subject to the European Union's GDPR, cold prospecting emails to individuals (including individual business emails) require either prior consent or a validated "Legitimate Interest" assessment. We recommend running bounce audits and targeting only valid company mailboxes (e.g. info@, office@, contact@) rather than personal domains when emailing within the EU.
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
