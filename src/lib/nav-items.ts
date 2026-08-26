import type { LucideIcon } from "lucide-react";
import { ChartColumnBig, Home, NotebookText, PieChart, Settings, Users } from "lucide-react";

export type NavItem = {
  href: string;
  // Key into the "nav" message namespace (messages/{locale}.json).
  labelKey: "home" | "ledger" | "portfolio" | "analysis" | "groups" | "settings";
  icon: LucideIcon;
};

// Öneriler (/oneriler) sekmesi v2'ye ertelendi ve yerini Analiz aldı. Öneri
// motorunun geri kalanı (edge function'lar, recommendations/market_events
// tabloları, pg_cron işleri, src/lib/recommendations*.ts, API route'ları)
// KASITLI olarak yerinde bırakıldı — çalışan ve test edilmiş bir motoru
// silmek v2'de sıfırdan yazmak anlamına gelirdi. Şu an yalnızca kullanıcıya
// açılan yüzey kapalı: sekme yok, sayfa yok, ana sayfadaki sinyal şeridi yok.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", labelKey: "home", icon: Home },
  { href: "/defter", labelKey: "ledger", icon: NotebookText },
  { href: "/analiz", labelKey: "analysis", icon: ChartColumnBig },
  { href: "/portfoy", labelKey: "portfolio", icon: PieChart },
  { href: "/gruplar", labelKey: "groups", icon: Users },
  { href: "/ayarlar", labelKey: "settings", icon: Settings },
];
