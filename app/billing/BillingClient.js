"use client";

import { Check, Crown, Sparkles, Zap, ShieldCheck, ArrowUpRight, Star } from "lucide-react";
import AppShell from "../components/app/AppShell";
import { useMe } from "../components/AccountWidget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const PLANS = [
  { id: "p19", name: "Starter", price: 19, quota: 5000, quotaLabel: "5,000 leads / month",
    perks: ["5,000 enriched leads / mo", "Email + social enrichment", "Website health checks", "CSV export"] },
  { id: "p49", name: "Growth", price: 49, quota: 50000, quotaLabel: "50,000 leads / month", popular: true,
    perks: ["50,000 enriched leads / mo", "Everything in Starter", "Priority in the job queue", "WhatsApp checks"] },
  { id: "p99", name: "Scale", price: 99, quota: null, quotaLabel: "Unlimited leads / month",
    perks: ["Unlimited leads / mo", "Everything in Growth", "Highest queue priority", "Best for agencies"] },
];

const FAQ = [
  { q: "How is usage counted?", a: "Each unique business captured and enriched counts once against your monthly quota. Re-checking or auditing an existing lead is free." },
  { q: "Can I change plans?", a: "Yes, upgrade or downgrade anytime. Changes take effect immediately and your quota updates to the new plan." },
  { q: "How do I cancel?", a: "Subscriptions are managed through Whop. Open the checkout/portal from any plan button to manage or cancel. No contracts." },
];

function checkoutHref(planId) {
  return `${BASE_PATH}/api/billing/checkout?plan=${planId}`;
}

export default function BillingClient() {
  const me = useMe();
  const loading = !me;
  const ent = me?.entitlement;
  const planKey = ent?.plan;
  const active = !!ent?.active;
  const current = PLANS.find((p) => p.id === planKey);

  const quota = current?.quota;
  const remaining = ent?.remaining;
  const unlimited = active && (remaining === null || planKey === "p99");
  const used = quota && remaining != null ? Math.max(0, quota - remaining) : 0;
  const pct = quota && remaining != null ? Math.min(100, (used / quota) * 100) : active ? 100 : 0;

  return (
    <AppShell
      active="billing"
      title="Billing & plans"
      subtitle="Manage your subscription and monthly lead quota"
    >
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Current plan + usage */}
        <Card className="overflow-hidden">
          <div className="grid gap-px bg-border/60 md:grid-cols-[1.4fr_1fr]">
            <div className="bg-card p-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Current plan</span>
                {loading ? (
                  <Skeleton className="h-5 w-16" />
                ) : active ? (
                  <Badge variant="success" className="gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active</Badge>
                ) : (
                  <Badge variant="warning">No active plan</Badge>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Crown className="h-6 w-6" />
                </div>
                <div>
                  {loading ? (
                    <Skeleton className="h-7 w-32" />
                  ) : (
                    <div className="text-2xl font-bold">{current ? current.name : "Free"}</div>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {current ? `$${current.price}/month · ${current.quotaLabel}` : "Choose a plan to start finding leads at scale"}
                  </div>
                </div>
              </div>
              {!active && (
                <Button asChild className="mt-5">
                  <a href="#plans"><Sparkles className="h-4 w-4" /> Choose a plan</a>
                </Button>
              )}
              {active && (
                <Button asChild variant="outline" className="mt-5">
                  <a href={checkoutHref(planKey)} target="_blank" rel="noreferrer">Manage subscription <ArrowUpRight className="h-4 w-4" /></a>
                </Button>
              )}
            </div>

            <div className="bg-card p-6">
              <span className="text-sm font-medium text-muted-foreground">This month's usage</span>
              <div className="mt-3 space-y-2">
                {loading ? (
                  <Skeleton className="h-8 w-40" />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">{unlimited ? "∞" : used.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground">
                      {unlimited ? "leads · unlimited" : quota ? `/ ${quota.toLocaleString()} leads` : "leads"}
                    </span>
                  </div>
                )}
                <Progress value={pct} indicatorClassName={pct >= 90 && !unlimited ? "bg-amber-500" : "bg-primary"} />
                <p className="text-xs text-muted-foreground">
                  {!active
                    ? "Activate a plan to unlock your monthly lead quota."
                    : unlimited
                      ? "You're on the unlimited plan, so find as many leads as you need."
                      : `${Number(remaining || 0).toLocaleString()} leads remaining this cycle.`}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Plans */}
        <div id="plans">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">{active ? "Change your plan" : "Choose a plan"}</h2>
              <p className="text-sm text-muted-foreground">Upgrade, downgrade or cancel anytime. Billed monthly via Whop.</p>
            </div>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-3">
            {PLANS.map((plan) => {
              const isCurrent = active && plan.id === planKey;
              return (
                <Card
                  key={plan.id}
                  className={cn(
                    "relative",
                    plan.popular && !isCurrent && "border-primary/60 shadow-lg shadow-primary/10",
                    isCurrent && "border-primary ring-1 ring-primary"
                  )}
                >
                  {plan.popular && !isCurrent && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1"><Star className="h-3 w-3" /> Popular</Badge>
                  )}
                  {isCurrent && (
                    <Badge variant="success" className="absolute -top-3 left-1/2 -translate-x-1/2">Current plan</Badge>
                  )}
                  <CardHeader>
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    <CardDescription>{plan.quotaLabel}</CardDescription>
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
                    {isCurrent ? (
                      <Button className="w-full" variant="secondary" disabled>Current plan</Button>
                    ) : (
                      <Button asChild className="w-full" variant={plan.popular ? "default" : "outline"}>
                        <a href={checkoutHref(plan.id)} target="_blank" rel="noreferrer">
                          {active ? "Switch" : "Get"} {plan.name}
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Trust + FAQ */}
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card className="bg-card/60">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><ShieldCheck className="h-5 w-5" /></div>
              <CardTitle className="text-base">Secure & flexible</CardTitle>
              <CardDescription>Payments are processed by Whop. Your leads and projects stay private to your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Quota updates instantly on upgrade</div>
              <div className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" /> Cancel anytime, no contracts</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60">
            <CardHeader><CardTitle className="text-base">Billing FAQ</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border/60">
              {FAQ.map(({ q, a }) => (
                <div key={q} className="py-3 first:pt-0 last:pb-0">
                  <div className="text-sm font-medium text-foreground">{q}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{a}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
