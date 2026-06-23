"use client";
import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Mail, MessageSquare, Send, CheckCircle, Menu, X, ArrowLeft } from "lucide-react";
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

export default function ContactPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [formState, setFormState] = useState({ name: "", email: "", subject: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
      setFormState({ name: "", email: "", subject: "", message: "" });
    }, 1200);
  };

  const handleChange = (e) => {
    setFormState({ ...formState, [e.target.name]: e.target.value });
  };

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
      <main className="container max-w-5xl mx-auto px-4 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-primary hover:underline mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="mb-10 text-center sm:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground/70 shadow-sm mb-4">
            <MessageSquare className="h-3.5 w-3.5 text-primary" /> Support Center
          </span>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-foreground">Contact Us</h1>
          <p className="mt-3 text-muted-foreground">Have questions or need help? Reach out and we'll get back to you shortly.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Info Card */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-[2rem] border border-border bg-card p-8 shadow-sm space-y-6">
              <h2 className="text-2xl font-bold text-foreground">Get in touch</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Whether you have custom requirements, need technical assistance, or want to discuss pricing for high-volume lead scraping, we are here to support you.
              </p>
              
              <div className="space-y-4 pt-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-xs text-muted-foreground">General Support</div>
                    <a href="mailto:support@leadsfunda.com" className="text-sm font-semibold text-foreground hover:underline">
                      support@leadsfunda.com
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Form Card */}
          <div className="lg:col-span-3">
            <div className="rounded-[2rem] border border-border bg-card p-6 sm:p-8 shadow-sm">
              {submitted ? (
                <div className="text-center py-12 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#a2e435]/15 text-[#a2e435]">
                    <CheckCircle className="h-8 w-8" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">Message Sent Successfully!</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Thank you for reaching out. A support agent will review your inquiry and respond to your email address within 24 hours.
                  </p>
                  <button
                    onClick={() => setSubmitted(false)}
                    className="mt-6 rounded-xl border border-border bg-card px-5 py-2 text-sm text-foreground hover:bg-muted transition-all"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="name" className="text-xs font-semibold text-muted-foreground">Your Name</label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formState.name}
                        onChange={handleChange}
                        className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-slate-400 focus:border-primary focus:outline-none transition-colors"
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="email" className="text-xs font-semibold text-muted-foreground">Email Address</label>
                      <input
                        type="email"
                        id="email"
                        name="email"
                        required
                        value={formState.email}
                        onChange={handleChange}
                        className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-slate-400 focus:border-primary focus:outline-none transition-colors"
                        placeholder="john@example.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="subject" className="text-xs font-semibold text-muted-foreground">Subject</label>
                    <input
                      type="text"
                      id="subject"
                      name="subject"
                      required
                      value={formState.subject}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-slate-400 focus:border-primary focus:outline-none transition-colors"
                      placeholder="Pricing questions / technical feedback"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="message" className="text-xs font-semibold text-muted-foreground">Message</label>
                    <textarea
                      id="message"
                      name="message"
                      required
                      rows={5}
                      value={formState.message}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-slate-400 focus:border-primary focus:outline-none transition-colors resize-none"
                      placeholder="Write your details here..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="lf-cta flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground py-3 font-semibold hover:bg-primary/95 transition-all duration-200 disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    ) : (
                      <>
                        <Send className="h-4 w-4" /> Send Message
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
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
