import type { AppLocale } from "@/lib/locale";

// Eksen etiketleri için kısa ay adı. src/lib/format.ts'teki formatMonthYear
// "Ağustos 2026" veriyor — bir eksende 6 tanesi yan yana sığmıyor ve
// çakışıyor. Buradaki biçim "Ağu" / "Aug"; yıl, yalnızca ocak ayında
// gösteriliyor ki 6 aylık pencere bir yıl sınırını geçtiğinde okuyucu
// nerede olduğunu kaybetmesin.
//
// Intl her zaman kullanılıyor, elle ay adı tablosu YOK (CLAUDE.md scaffold
// kuralı: "tr-TR locale utils, asla manuel string").
export function shortMonthLabel(monthKey: string, locale: AppLocale): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const name = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return month === 1 ? `${name} ${year}` : name;
}
