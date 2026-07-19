import type { LucideIcon } from "lucide-react";
import { Home, NotebookText, PieChart, Settings, Sparkles } from "lucide-react";

export type NavItem = {
  href: string;
  // Key into the "nav" message namespace (messages/{locale}.json).
  labelKey: "home" | "ledger" | "portfolio" | "recommendations" | "settings";
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", labelKey: "home", icon: Home },
  { href: "/defter", labelKey: "ledger", icon: NotebookText },
  { href: "/portfoy", labelKey: "portfolio", icon: PieChart },
  { href: "/oneriler", labelKey: "recommendations", icon: Sparkles },
  { href: "/ayarlar", labelKey: "settings", icon: Settings },
];
