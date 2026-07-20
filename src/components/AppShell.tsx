"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav-items";
import { IconMark } from "@/lib/app-icon";
import { Button } from "@/components/ui/button";
import { OfflineBanner } from "@/components/OfflineBanner";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar md:text-sidebar-foreground">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="size-8 shrink-0 overflow-hidden rounded-lg">
            <IconMark padding={5} barGap={3} />
          </div>
          <span className="text-sm font-semibold">{tCommon("appName")}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <LocaleSwitcher className="mb-2 w-full justify-center" />
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-4" />
              {tCommon("logout")}
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex flex-1 flex-col md:min-w-0">
        <header className="safe-area-top sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm md:hidden">
          <div className="flex items-center gap-2">
            <div className="size-6 shrink-0 overflow-hidden rounded-md">
              <IconMark padding={3} barGap={2} />
            </div>
            <span className="text-sm font-semibold text-foreground">
              {tCommon("appName")}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                size="icon-touch"
                aria-label={tCommon("logout")}
              >
                <LogOut className="size-5" />
              </Button>
            </form>
          </div>
        </header>

        <OfflineBanner />

        <main className="flex flex-1 flex-col pb-20 md:pb-0">{children}</main>

        <nav className="safe-area-bottom fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-background md:hidden">
          {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-xl px-3 py-0.5",
                    active && "bg-primary/10",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
