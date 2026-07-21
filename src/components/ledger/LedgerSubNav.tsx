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
  { href: "/defter/gelirler", key: "income" },
  { href: "/defter/giderler", key: "expense" },
] as const;

// Route-based sub-navigation, not a stateful Tabs widget — each view is a
// real bookmarkable page, mirroring the top-level nav pattern already used
// in AppShell/nav-items.ts.
export function LedgerSubNav() {
  const pathname = usePathname();
  const t = useTranslations("ledger.nav");

  return (
    <nav className="flex gap-1 overflow-x-auto px-4 md:px-0">
      {TABS.map(({ href, key }) => {
        const active = href === "/defter" ? pathname === "/defter" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "min-h-touch shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
