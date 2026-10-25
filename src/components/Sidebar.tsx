"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

// Icônes de la DA : style trait, 1,75 px, bouts arrondis, pas d'emoji.
const ICONS = {
  overview: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14a6.5 6.5 0 0 1 3.5 6" />
    </svg>
  ),
  subscriptions: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  ),
  creators: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3M9 21h6" />
    </svg>
  ),
  catalog: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </svg>
  ),
  moderation: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6L12 3z" />
      <path d="M8.75 12l2.5 2.5 4-4.5" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M3.5 19.5h17" />
      <path d="M5 15l4-5 3.5 3.5L19 6" />
      <path d="M15.5 6H19v3.5" />
    </svg>
  ),
  plays: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M4 20V11" />
      <path d="M10 20V4" />
      <path d="M16 20v-6" />
      <path d="M21 20H3" />
    </svg>
  ),
  revenue: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9a3 3 0 0 0-5 1.5c0 3 5 1.5 5 4.5a3 3 0 0 1-5 1.5" />
      <path d="M12 6.5V8M12 16v1.5" />
    </svg>
  ),
  payouts: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="12" rx="3" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  fraud: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M12 3.5l9 16H3l9-16z" />
      <path d="M12 10v4.5M12 17.25v.01" />
    </svg>
  ),
  claims: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M6 21V4" />
      <path d="M6 5h11.5l-2.5 4 2.5 4H6" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
      <path d="M7 7.25h.01M7 16.75h.01" />
      <path d="M11 7.25h6M11 16.75h6" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
    </svg>
  ),
} as const;

// Sur mobile la barre du bas est limitée à 5 icônes (DA) : les autres pages
// restent accessibles sur desktop uniquement.
const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: ICONS.overview, desktopOnly: false },
  { href: "/users", label: "Users", icon: ICONS.users, desktopOnly: false },
  { href: "/creators", label: "Creators", icon: ICONS.creators, desktopOnly: false },
  { href: "/catalog", label: "Catalog", icon: ICONS.catalog, desktopOnly: false },
  { href: "/moderation", label: "Moderation", icon: ICONS.moderation, desktopOnly: false },
  { href: "/claims", label: "Claims", icon: ICONS.claims, desktopOnly: true },
  { href: "/subscriptions", label: "Subscriptions", icon: ICONS.subscriptions, desktopOnly: true },
  { href: "/analytics", label: "Analytics", icon: ICONS.analytics, desktopOnly: true },
  { href: "/plays", label: "Plays", icon: ICONS.plays, desktopOnly: true },
  { href: "/revenue", label: "Revenue", icon: ICONS.revenue, desktopOnly: true },
  { href: "/payouts", label: "Payouts", icon: ICONS.payouts, desktopOnly: true },
  { href: "/fraud", label: "Fraud", icon: ICONS.fraud, desktopOnly: true },
  { href: "/audit", label: "Audit log", icon: ICONS.audit, desktopOnly: true },
  { href: "/system", label: "System", icon: ICONS.system, desktopOnly: true },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="sidebar" aria-label="Admin">
      <Link href="/" className="sidebar__brand" aria-label="Vynl Admin — overview">
        <Logo />
        <span className="sidebar__tag">Admin</span>
      </Link>
      <div className="sidebar__links">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const classes = [
            "sidebar-link",
            isActive ? "active" : "",
            item.desktopOnly ? "sidebar-link--desktop-only" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <Link key={item.href} href={item.href} className={classes} aria-current={isActive ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
