"use client";

import { Fragment, useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import Image from "next/image";
import {
  Globe,
  Plug,
  LayoutGrid,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Search,
  HelpCircle,
  ChevronRight,
  Loader2,
} from "lucide-react";
import AccountWidget from "../AccountWidget";
import ExtensionUpdateBanner from "../ExtensionUpdateBanner";
import useSidebarCollapse from "../useSidebarCollapse";
import Tour from "../Tour";
import { Sheet, SheetContent } from "../ui/sheet";
import { cn } from "../../lib/utils";
import { SHOW_CREDITS } from "../../../web/lib/credits-ui.cjs";

// Fallback tour for pages that don't ship a section-specific one. Each page passes
// its own `tourKey` + `tourSteps` (see app/dashboard-home.js, leads, lists) so the
// walkthrough explains that section; a missing target just centers the copy.
const DEFAULT_TOUR = [
  ...(SHOW_CREDITS
    ? [{ key: "credits", title: "Credits", body: "One balance for everything: 1 credit per new lead, 3 per audit, 5 per chatbot scan, 10 per full report." }]
    : []),
  { key: "tour-button", title: "Replay anytime", body: "Click Tour up here whenever you want to see a section's walkthrough again." },
];

// "New search" (the find-leads start page) sits above a grouped "Projects" section
// — Projects opens the workspace (?view=projects), with Leads + Lists under the same
// umbrella. Billing lives in the account menu now (not the sidebar).
const NEW_SEARCH = { key: "new", label: "New search", href: "/dashboard", icon: Search };
// One entry, not two. "Leads" and "Lists" were the same job split in half, so
// Lists is now the single door: the cards overview at /lists (create, rename,
// delete, plus Favorites and All leads), and opening a card lands in the leads
// table filtered to it, where the actual work happens. /leads keeps working and
// highlights this entry — it just isn't a separate destination any more.
const PROJECT_NAV = [
  { key: "dashboard", label: "Projects", href: "/dashboard?view=projects", icon: LayoutGrid },
  { key: "lists", label: "Lists", href: "/lists", icon: List },
];
// Standalone utilities that aren't part of the Maps scrape workflow — their own
// section rather than folded into Projects, so they don't read as another kind
// of project.
const MISC_NAV = [
  { key: "domain-finder", label: "Domain Leads Finder", href: "/domain-finder", icon: Globe },
  { key: "integrations", label: "Integrations", href: "/integrations", icon: Plug },
];

// Live search runs in the extension, so "is it installed?" is a standing piece
// of account state — it needs a permanent home. That home is now the account
// menu at the bottom of the sidebar (see app/components/AccountWidget.js), which
// keeps it reachable from every page without spending a top-level nav slot.

function Brand({ collapsed, onClick }) {
  return (
    <Link href="/dashboard" title="Find leads" className="flex items-center" onClick={onClick}>
      {collapsed ? (
        <Image src="/brand/leadsfunda-icon.svg" alt="LeadsFunda" width={36} height={36} priority />
      ) : (
        <Image src="/brand/leadsfunda-white.svg" alt="LeadsFunda" width={140} height={27} priority />
      )}
    </Link>
  );
}

// Every app route is force-dynamic, so a click on a slow connection paints
// nothing at all until the server answers — the sidebar does not even highlight,
// and it reads as a click that did not register. useLinkStatus reports the
// pending navigation, but only from inside the Link, so the icon lives in its
// own component. It swaps the item's own icon for a spinner rather than adding
// one, which keeps the row from shifting.
function NavIcon({ icon: Icon }) {
  const { pending } = useLinkStatus();
  return pending
    ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" />
    : <Icon className="h-[18px] w-[18px] shrink-0" />;
}

function NavItem({ item, active, collapsed, onNavigate, prominent, trailingSpace, badge }) {
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
        trailingSpace && "pr-9",
        isActive
          ? "bg-primary/10 text-primary"
          : prominent
            ? "text-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
      <NavIcon icon={Icon} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge != null && (
        <span className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {badge}
        </span>
      )}
    </Link>
  );
}

// `projectsNav` is the caller's own project list, nested directly beneath the
// Projects link rather than floating in a separate block further down the
// sidebar, so the list reads as belonging to the item that opens it. It is
// dropped in the icon rail, where there is no room to show names.
function NavLinks({ active, collapsed, onNavigate, projectsNav, projectsCount }) {
  // The nested project list is collapsible from the Projects row's chevron.
  // Remembered per browser, because whether somebody wants the list open is a
  // standing preference, not a per-page one.
  const [projectsOpen, setProjectsOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("lf_projects_open") === "0") setProjectsOpen(false);
    } catch {}
  }, []);
  const toggleProjects = () => {
    setProjectsOpen((open) => {
      try { localStorage.setItem("lf_projects_open", open ? "0" : "1"); } catch {}
      return !open;
    });
  };

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
      {PROJECT_NAV.map((item) => {
        const expandable = item.key === "dashboard" && !collapsed && projectsNav;
        return (
          <Fragment key={item.key}>
            {expandable ? (
              // The chevron sits over the link rather than inside it: a button
              // nested in an <a> is invalid, and the link itself must still
              // navigate to the workspace when the row is clicked.
              <div className="relative">
                <NavItem item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} trailingSpace badge={projectsCount} />
                <button
                  type="button"
                  onClick={toggleProjects}
                  aria-expanded={projectsOpen}
                  aria-label={projectsOpen ? "Collapse projects" : "Expand projects"}
                  title={projectsOpen ? "Collapse projects" : "Expand projects"}
                  className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ChevronRight
                    className={cn("h-4 w-4 transition-transform duration-200", projectsOpen && "rotate-90")}
                  />
                </button>
              </div>
            ) : (
              <NavItem item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
            )}
            {expandable ? (
              // grid-rows 1fr → 0fr animates to the list's natural height without
              // hard-coding one. Capped rather than unbounded: a long project list
              // would otherwise push Leads and Lists off the bottom of the sidebar.
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                  projectsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="overflow-hidden">
                  <div className="thin-scroll mb-1 ml-[22px] max-h-[38vh] overflow-y-auto border-l border-border/60 pl-1.5">
                    {projectsNav}
                  </div>
                </div>
              </div>
            ) : null}
          </Fragment>
        );
      })}
      {collapsed ? (
        <div className="mx-auto my-1.5 h-px w-8 bg-border/60" />
      ) : (
        <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Misc tools
        </div>
      )}
      {MISC_NAV.map((item) => (
        <NavItem key={item.key} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export default function AppShell({ active, title, subtitle, actions, sidebarExtra, projectsNav, projectsCount, children, tourKey = "", tourSteps }) {
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
        {/* Same height and same border weight as the topbar next to it, so the
            two read as one continuous line across the top of the app. */}
        <div className={cn("flex h-16 shrink-0 items-center border-b border-border", collapsed ? "justify-center gap-1 px-2" : "justify-between px-4")}>
          <Brand
            collapsed={collapsed}
            onClick={(e) => {
              if (collapsed) {
                e.preventDefault();
                toggleCollapsed();
              }
            }}
          />
          {!collapsed && (
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
          )}
        </div>

        <div className={cn("px-3 py-4", collapsed && "px-2")}>
          <NavLinks active={active} collapsed={collapsed} projectsNav={projectsNav} projectsCount={projectsCount} />
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
        <SheetContent side="left" className="flex h-full flex-col p-0 overflow-hidden">
          <div className="flex h-16 shrink-0 items-center justify-center border-b border-border/60 px-4">
            <Brand collapsed={false} />
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <NavLinks active={active} collapsed={false} onNavigate={() => setMobileOpen(false)} projectsNav={projectsNav} projectsCount={projectsCount} />
            {sidebarExtra ? <div className="mt-4">{sidebarExtra}</div> : null}
          </div>
          <div className="shrink-0 border-t border-border/60">
            <AccountWidget />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* h-16, matching the sidebar's brand row exactly — the two bottom
            borders have to land on the same line or the whole top of the app
            looks off. Fixed height rather than min-h because a title and its
            subtitle together still fit inside 64px. */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
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
          {/* Page actions first, Tour last: Tour is the same on every page, so
              it belongs at the edge as a fixed landmark rather than shoving the
              page's own controls around. */}
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              data-tour="tour-button"
              onClick={() => { setTourOpen(true); }}
              title="Start the guided tour"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" /> <span className="hidden sm:inline">Tour</span>
            </button>
          </div>
        </header>

        {/* Sits below the sticky header, above the page: it scrolls away rather
            than eating height on every screen forever, but it is the first
            thing under the title bar on arrival. */}
        <ExtensionUpdateBanner />

        {/* overflow-x-clip is a page-level guard against horizontal scroll on
            mobile; wide tables still scroll inside their own overflow wrappers. */}
        <main className="min-w-0 flex-1 overflow-x-clip">{children}</main>
      </div>
    </div>
  );
}
