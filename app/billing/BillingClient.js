"use client";

import { Check, Crown, Sparkles, ArrowUpRight, Star, Coins } from "lucide-react";
import AppShell from "../components/app/AppShell";
import { useMe } from "../components/AccountWidget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Canonical plans — ids must match billing.cjs (p19/p35/p49). `rank` drives the
// "don't offer a downgrade" rule. One unified credit pool: a plan's monthly grant
// IS its credit allowance (find a lead = 1 credit, audit 3, chatbot 5, report 10).
const PLANS = [
  { id: "p19", name: "Starter", price: 19, credits: 5000, rank: 1, creditLabel: "5,000 credits / month",
    perks: ["5,000 credits / mo", "Find + enrich leads", "Website health checks", "CSV export"] },
  { id: "p35", name: "Growth", price: 35, credits: 50000, rank: 2, popular: true, creditLabel: "50,000 credits / month",
    perks: ["50,000 credits / mo", "Everything in Starter", "Priority in the job queue", "WhatsApp checks"] },
  { id: "p49", name: "Scale", price: 49, credits: null, rank: 3, creditLabel: "Unlimited credits / month",
    perks: ["Unlimited credits / mo", "Everything in Growth", "Highest queue priority", "Best for agencies"] },
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
  const currentRank = current?.rank || 0;

  const unlimited = !!ent?.unlimited;
  const credits = Number(ent?.credits || 0);
  const monthly = ent?.monthly != null ? Number(ent.monthly) : current?.credits ?? null;
  const used = monthly != null ? Math.max(0, monthly - credits) : 0;
  const pct = monthly ? Math.min(100, (used / monthly) * 100) : active ? 100 : 0;

  // On the top plan we never show a downgrade: only the current + higher tiers.
  const visiblePlans = active ? PLANS.filter((p) => p.rank >= currentRank) : PLANS;

  return (
    <AppShell
      active="billing"
      title="Billing & plans"
      subtitle="Manage your subscription and monthly credits"
    >
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Current plan + credit balance */}
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
                    {current ? `$${current.price}/month · ${current.creditLabel}` : "Choose a plan to get monthly credits"}
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
              <span className="text-sm font-medium text-muted-foreground">Credit balance</span>
              <div className="mt-3 space-y-2">
                {loading ? (
                  <Skeleton className="h-8 w-40" />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <Coins className="h-6 w-6 self-center text-primary" />
                    <span className="text-3xl font-bold">{unlimited ? "∞" : credits.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground">{unlimited ? "credits · unlimited" : "credits left"}</span>
                  </div>
                )}
                {!unlimited && monthly ? <Progress value={100 - pct} indicatorClassName={pct >= 90 ? "bg-amber-500" : "bg-primary"} /> : null}
                <p className="text-xs text-muted-foreground">
                  {!active && !credits
                    ? "Activate a plan to get monthly credits."
                    : unlimited
                      ? "You're on the unlimited plan — find and enrich as much as you need."
                      : monthly
                        ? `${credits.toLocaleString()} of ${monthly.toLocaleString()} credits remaining this cycle.`
                        : `${credits.toLocaleString()} credits available. 1 credit per lead · audit 3 · chatbot 5 · report 10.`}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Plans */}
        <div id="plans">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">{active ? (currentRank >= 3 ? "Your plan" : "Upgrade your plan") : "Choose a plan"}</h2>
              <p className="text-sm text-muted-foreground">
                {active && currentRank >= 3 ? "You're on the top plan." : "Upgrade or cancel anytime. Billed monthly via Whop."}
              </p>
            </div>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-3">
            {visiblePlans.map((plan) => {
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
                    <CardDescription>{plan.creditLabel}</CardDescription>
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
                          {active ? "Upgrade to" : "Get"} {plan.name}
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
