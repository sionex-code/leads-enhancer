"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  LayoutGrid,
  Database,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  ShieldCheck,
  Plus,
  HelpCircle,
} from "lucide-react";
import AccountWidget from "../AccountWidget";
import useSidebarCollapse from "../useSidebarCollapse";
import Tour from "../Tour";
import { Sheet, SheetContent } from "../ui/sheet";
import { cn } from "../../lib/utils";

// Fallback tour for pages that don't ship a section-specific one. Each page passes
// its own `tourKey` + `tourSteps` (see app/dashboard-home.js, leads, lists) so the
// walkthrough explains that section; a missing target just centers the copy.
const DEFAULT_TOUR = [
  { key: "credits", title: "Credits", body: "One balance for everything: 1 credit per new lead, 3 per audit, 5 per chatbot scan, 10 per full report." },
  { key: "tour-button", title: "Replay anytime", body: "Click Tour up here whenever you want to see a section's walkthrough again." },
];

// "New search" (the find-leads start page) sits above a grouped "Projects" section
// — Projects opens the workspace (?view=projects), with Leads + Lists under the same
// umbrella. Billing lives in the account menu now (not the sidebar).
const NEW_SEARCH = { key: "new", label: "New search", href: "/dashboard", icon: Plus };
const PROJECT_NAV = [
  { key: "dashboard", label: "Projects", href: "/dashboard?view=projects", icon: LayoutGrid },
  { key: "leads", label: "Leads", href: "/leads", icon: Database },
  { key: "lists", label: "Lists", href: "/lists", icon: List },
];

function Brand({ collapsed }) {
  return (
    <Link href="/dashboard" title="Find leads" className="flex items-center">
      {collapsed ? (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" />
        </span>
      ) : (
        <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={140} height={27} priority />
      )}
    </Link>
  );
}

function NavItem({ item, active, collapsed, onNavigate, prominent }) {
  const { key, label, href, icon: Icon } = item;
  const isActive = active === key;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-tour={`nav-${key}`}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        isActive
          ? "bg-primary/10 text-primary"
          : prominent
            ? "text-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function NavLinks({ active, collapsed, onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      <NavItem item={NEW_SEARCH} active={active} collapsed={collapsed} onNavigate={onNavigate} prominent />
      {collapsed ? (
        <div className="mx-auto my-1.5 h-px w-8 bg-border/60" />
      ) : (
        <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Projects
        </div>
      )}
      {PROJECT_NAV.map((item) => (
        <NavItem key={item.key} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export default function AppShell({ active, title, subtitle, actions, sidebarExtra, children, tourKey = "", tourSteps }) {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const steps = tourSteps && tourSteps.length ? tourSteps : DEFAULT_TOUR;

  // Auto-start each section's tour once per browser (remembered in localStorage);
  // the topbar "Tour" button replays the current section's tour anytime.
  useEffect(() => {
    if (!tourKey) return;
    let seen = true;
    try { seen = !!localStorage.getItem("lf_tour_" + tourKey); } catch {}
    if (seen) return;
    const t = setTimeout(() => setTourOpen(true), 500);
    return () => clearTimeout(t);
  }, [tourKey]);

  const closeTour = () => {
    setTourOpen(false);
    try { if (tourKey) localStorage.setItem("lf_tour_" + tourKey, "1"); } catch {}
  };

  return (
    <div className="lf flex min-h-screen bg-background text-foreground">
      <Tour steps={steps} open={tourOpen} onClose={closeTour} />
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card/40 backdrop-blur transition-[width] duration-200 md:flex",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-border/60", collapsed ? "justify-center gap-1 px-2" : "justify-between px-4")}>
          <Brand collapsed={collapsed} />
          <button
            onClick={toggleCollapsed}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              collapsed && "mt-0"
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <div className={cn("px-3 py-4", collapsed && "px-2")}>
          <NavLinks active={active} collapsed={collapsed} />
        </div>

        {!collapsed && sidebarExtra ? (
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3">{sidebarExtra}</div>
        ) : (
          <div className="min-h-0 flex-1" />
        )}

        <div className="border-t border-border/60" data-tour="credits">
          <AccountWidget collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0">
          <div className="flex h-16 items-center border-b border-border/60 px-4">
            <Brand collapsed={false} />
          </div>
          <div className="thin-scroll flex-1 overflow-y-auto px-3 py-4">
            <NavLinks active={active} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            {sidebarExtra ? <div className="mt-4">{sidebarExtra}</div> : null}
          </div>
          <div className="border-t border-border/60">
            <AccountWidget />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            title="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            {title ? <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">{title}</h1> : null}
            {subtitle ? <div className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-tour="tour-button"
              onClick={() => { setTourOpen(true); }}
              title="Start the guided tour"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" /> <span className="hidden sm:inline">Tour</span>
            </button>
            {actions}
          </div>
        </header>

        {/* overflow-x-clip is a page-level guard against horizontal scroll on
            mobile; wide tables still scroll inside their own overflow wrappers. */}
        <main className="min-w-0 flex-1 overflow-x-clip">{children}</main>
      </div>
    </div>
  );
}
