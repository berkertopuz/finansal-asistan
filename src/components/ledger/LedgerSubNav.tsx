"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Abonelikler isn't its own tab — Giderler's "tüm abonelikleri gör" card
// (src/app/(app)/defter/giderler/page.tsx) links straight to
// /defter/abonelikler instead, so the page stays reachable without needing
// a permanent slot in this bar.
const TABS = [
  { href: "/defter", key: "all" },
  { href: "/defter/giderler", key: "expense" },
  { href: "/defter/gelirler", key: "income" },
] as const;

// Route-based sub-navigation, not a stateful Tabs widget — each view is a
// real bookmarkable page, mirroring the top-level nav pattern already used
// in AppShell/nav-items.ts.
export function LedgerSubNav() {
  const pathname = usePathname();
  const t = useTranslations("ledger.nav");

  return (
    // Segmented pill control, not plain underlined text tabs — the active
    // tab is its own solid pill inside a rounded track, matching the same
    // rounded-full language as the hero's action buttons instead of reading
    // as a leftover default tab bar. Active pill uses bg-primary (brand
    // teal), the same color AppShell's own sidebar/tab-bar nav already uses
    // for "this is where you are" — a neutral bg-card pill here read as
    // colorless next to that established convention.
    <nav className="mx-4 flex gap-1 rounded-full bg-muted md:mx-0 md:w-fit">
      {TABS.map(({ href, key }) => {
        const active = href === "/defter" ? pathname === "/defter" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              // flex + items-center centers the label on both axes
              // regardless of how min-h-touch's 48px floor compares to the
              // text's own line height — py-2 alone left it vertically
              // top-aligned inside the taller box on desktop, where the pill
              // never grows past that 48px minimum the way it might with
              // more padding.
              "flex min-h-touch flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors md:flex-none",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
