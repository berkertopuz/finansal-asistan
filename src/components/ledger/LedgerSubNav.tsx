"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/defter", key: "all" },
  { href: "/defter/gelirler", key: "income" },
  { href: "/defter/giderler", key: "expense" },
  { href: "/defter/abonelikler", key: "subscription" },
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
                ? "bg-primary text-primary-foreground"
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
