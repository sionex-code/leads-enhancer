"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { LogOut, Crown, CreditCard, ChevronsUpDown, Sparkles, ShieldCheck } from "lucide-react";
import { Avatar } from "./ui/avatar";
import { Progress } from "./ui/progress";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { cn } from "./../lib/utils";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
// Canonical plan keys — must match billing.cjs (p19 Starter · p35 Growth · p49
// Scale). The old p49/p99 mapping linked checkout to ?plan=p99, which the server
// rejects as "Unknown plan", so upgrades silently failed.
const PLAN_LABEL = { p19: "Starter", p35: "Growth", p49: "Scale" };
const PLAN_QUOTA = { p19: 5000, p35: 50000, p49: null };

export function useMe(pollMs = 10000) {
  const [me, setMe] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${BASE_PATH}/api/me`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setMe(d))
        .catch(() => {});
    load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);
  return me;
}

// Account / plan control shown at the bottom of the app sidebar. `collapsed`
// renders just the avatar (icon-rail mode).
export default function AccountWidget({ collapsed = false }) {
  const me = useMe();
  const ent = me?.entitlement;
  const planKey = ent?.plan;
  const plan = planKey ? PLAN_LABEL[planKey] || planKey : null;
  const email = me?.user?.email || "";
  const initial = (email || "?").slice(0, 1).toUpperCase();

  const quota = planKey ? PLAN_QUOTA[planKey] : undefined;
  const remaining = ent?.remaining;
  const unlimited = ent?.active && (remaining === null || planKey === "p49");
  const used = quota && remaining != null ? Math.max(0, quota - remaining) : 0;
  const pct = quota && remaining != null ? Math.min(100, (used / quota) * 100) : ent?.active ? 100 : 0;
  const quotaText = !ent || !ent.active
    ? "No active plan"
    : unlimited
      ? "Unlimited leads"
      : `${Number(remaining || 0).toLocaleString()} leads left`;

  const PLANS = [
    { id: "p19", label: "Starter ($19)" },
    { id: "p35", label: "Growth ($35)" },
    { id: "p49", label: "Scale ($49)" },
  ];
  const offerable = me ? PLANS.filter((p) => p.id !== planKey) : [];

  if (collapsed) {
    return (
      <div className="flex justify-center p-2">
        <Link href="/billing" title={email}>
          <Avatar src={me?.user?.image} alt={email} fallback={initial} />
        </Link>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg p-1 text-left transition-colors hover:bg-accent/60">
              <Avatar src={me?.user?.image} alt={email} fallback={initial} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{email || "Loading…"}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {plan ? (
                    <><Crown className="h-3 w-3 text-primary" /> {plan} plan</>
                  ) : (
                    "Free account"
                  )}
                </span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            <DropdownMenuLabel>{ent?.active ? "Manage plan" : "Get started"}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/billing"><CreditCard className="h-4 w-4" /> Billing &amp; plans</Link>
            </DropdownMenuItem>
            {me?.admin && (
              <DropdownMenuItem asChild>
                <Link href="/admin"><ShieldCheck className="h-4 w-4 text-primary" /> Admin panel</Link>
              </DropdownMenuItem>
            )}
            {offerable.length > 0 && <DropdownMenuSeparator />}
            {offerable.map((p) => (
              <DropdownMenuItem key={p.id} asChild>
                <a href={`${BASE_PATH}/api/billing/checkout?plan=${p.id}`}>
                  <Sparkles className="h-4 w-4 text-primary" /> {ent?.active ? "Switch to" : "Get"} {p.label}
                </a>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })} className="text-red-600 hover:text-red-700">
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className={cn("font-medium", ent?.active ? "text-foreground" : "text-amber-600")}>{quotaText}</span>
            {!unlimited && quota ? <span className="text-muted-foreground">{used.toLocaleString()}/{quota.toLocaleString()}</span> : null}
          </div>
          <Progress value={pct} className="h-1.5" indicatorClassName={ent?.active ? "bg-primary" : "bg-amber-500"} />
          {!ent?.active && (
            <Link
              href="/billing"
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Sparkles className="h-3.5 w-3.5" /> Choose a plan
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
