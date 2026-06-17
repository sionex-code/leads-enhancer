"use client";

import Link from "next/link";
import { Database, LayoutGrid, Star } from "lucide-react";

// App-style bottom tab bar, shown on small screens only (see globals.css).
// AI agent tab temporarily hidden for the SaaS launch.
export default function MobileNav({ active }) {
  const tabs = [
    { key: "projects", href: "/dashboard?view=projects", label: "Projects", Icon: LayoutGrid },
    { key: "leads", href: "/leads", label: "Leads", Icon: Database },
    { key: "watchlist", href: "/watchlist", label: "Watch", Icon: Star },
  ];
  return (
    <nav className="mobile-nav">
      {tabs.map(({ key, href, label, Icon }) => (
        <Link key={key} href={href} className={`mobile-tab ${active === key ? "active" : ""}`}>
          <Icon size={21} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
