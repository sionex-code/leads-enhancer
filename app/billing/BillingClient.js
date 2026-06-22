"use client";

import { useState, useEffect } from "react";
import { Check, Crown, Sparkles, ArrowUpRight, Star, Coins, Search, Users, Clock } from "lucide-react";
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
    dailySearches: 20, dailyLeads: 400,
    perks: ["5,000 credits / mo", "Find + enrich leads", "Website health checks", "CSV export"] },
  { id: "p35", name: "Growth", price: 35, credits: 50000, rank: 2, popular: true, creditLabel: "50,000 credits / month",
    dailySearches: 100, dailyLeads: 1500,
    perks: ["50,000 credits / mo", "Everything in Starter", "Priority in the job queue", "WhatsApp checks"] },
  { id: "p49", name: "Scale", price: 49, credits: null, rank: 3, creditLabel: "Unlimited credits / month",
    dailySearches: 1000, dailyLeads: 5000,
    perks: ["Unlimited credits / mo", "Everything in Growth", "Highest queue priority", "Best for agencies"] },
];

function checkoutHref(planId) {
  return `${BASE_PATH}/api/billing/checkout?plan=${planId}`;
}

// "Xh Ym" until an ISO reset instant.
function untilReset(resetAt) {
  if (!resetAt) return "tonight";
  const ms = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

const fmtLimit = (n) => (!n || n <= 0 ? "Unlimited" : Number(n).toLocaleString());

// One daily-allowance meter (searches or leads) with a usage bar.
function DailyMeter({ icon: Icon, label, metric, loading }) {
  const unlimited = !!metric?.unlimited;
  const limit = metric?.limit || 0;
  const used = metric?.used || 0;
  const remaining = unlimited ? null : Math.max(0, (metric?.remaining ?? limit) || 0);
  const pct = unlimited || !limit ? 0 : Math.min(100, (used / limit) * 100);
  const exhausted = !unlimited && remaining <= 0;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4" /> {label}
        </span>
        {loading ? (
          <Skeleton className="h-5 w-14" />
        ) : (
          <span className={cn("text-sm font-semibold tabular-nums", exhausted && "text-red-600")}>
            {unlimited ? "Unlimited" : `${remaining.toLocaleString()} left`}
          </span>
        )}
      </div>
      {!unlimited && limit ? (
        <>
          <Progress
            className="mt-3"
            value={100 - pct}
            indicatorClassName={pct >= 90 ? "bg-amber-500" : "bg-primary"}
          />
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {used.toLocaleString()} of {limit.toLocaleString()} used today
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No daily cap on your plan.</p>
      )}
    </div>
  );
}

export default function BillingClient() {
  const me = useMe();
  const loading = !me;

  // Live plan limits (with any admin overrides) for the daily search/lead caps.
  const [planLimits, setPlanLimits] = useState(null); // { [id]: { dailySearches, dailyLeads } }
  useEffect(() => {
    fetch(`${BASE_PATH}/api/billing/plans`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.packages) return;
        setPlanLimits(Object.fromEntries(d.packages.map((p) => [p.id, p])));
      })
      .catch(() => {});
  }, []);
  // Limits for a plan id: live (admin-overridable) values when loaded, else the
  // static defaults baked into PLANS.
  const limitsFor = (plan) => ({
    dailySearches: planLimits?.[plan.id]?.dailySearches ?? plan.dailySearches,
    dailyLeads: planLimits?.[plan.id]?.dailyLeads ?? plan.dailyLeads,
  });

  // When arriving from the landing pricing buttons (login → /billing?plan=pXX),
  // highlight the chosen plan and scroll it into view so the user lands exactly
  // on what they picked. Read from window so we don't need a Suspense boundary.
  const [selectedPlan, setSelectedPlan] = useState(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plan");
    if (p) setSelectedPlan(p);
  }, []);
  useEffect(() => {
    if (!selectedPlan || !me) return;
    const el = document.getElementById(`plan-${selectedPlan}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedPlan, me]);

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

  // Today's per-day usage (searches + leads) and when it resets.
  const daily = me?.daily;

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

        {/* Daily limits — searches + leads, with reset time */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">Today&apos;s limits</h3>
                <p className="text-sm text-muted-foreground">
                  Your plan includes a daily search and lead allowance on top of monthly credits.
                </p>
              </div>
              {daily ? (
                <Badge variant="outline" className="gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Resets in {untilReset(daily.resetAt)} · midnight {daily.tz}
                </Badge>
              ) : null}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <DailyMeter
                icon={Search}
                label="Searches today"
                metric={daily?.searches}
                loading={loading || !daily}
              />
              <DailyMeter
                icon={Users}
                label="Leads today"
                metric={daily?.leads}
                loading={loading || !daily}
              />
            </div>
          </CardContent>
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
              const isSelected = plan.id === selectedPlan && !isCurrent;
              return (
                <Card
                  key={plan.id}
                  id={`plan-${plan.id}`}
                  className={cn(
                    "relative scroll-mt-28 transition-shadow",
                    plan.popular && !isCurrent && !isSelected && "border-primary/60 shadow-lg shadow-primary/10",
                    isSelected && "border-primary ring-2 ring-primary shadow-xl shadow-primary/15",
                    isCurrent && "border-primary ring-1 ring-primary"
                  )}
                >
                  {isSelected && (
                    <Badge className="absolute -top-3 right-4 gap-1"><Sparkles className="h-3 w-3" /> Selected</Badge>
                  )}
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
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 text-base font-bold tabular-nums">
                          <Search className="h-3.5 w-3.5 text-primary" /> {fmtLimit(limitsFor(plan).dailySearches)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">searches / day</div>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 text-base font-bold tabular-nums">
                          <Users className="h-3.5 w-3.5 text-primary" /> {fmtLimit(limitsFor(plan).dailyLeads)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">leads / day</div>
                      </div>
                    </div>
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
