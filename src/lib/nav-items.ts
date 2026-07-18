import type { LucideIcon } from "lucide-react";
import { Home, NotebookText, PieChart, Settings, Sparkles } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Ana Sayfa", icon: Home },
  { href: "/defter", label: "Defter", icon: NotebookText },
  { href: "/portfoy", label: "Portföy", icon: PieChart },
  { href: "/oneriler", label: "Öneriler", icon: Sparkles },
  { href: "/ayarlar", label: "Ayarlar", icon: Settings },
];
