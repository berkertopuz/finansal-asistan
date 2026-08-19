"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { DayOfWeekStat } from "@/lib/analysis";

// "Hafta içi vs hafta sonu" ikili kıyasının yerine geçti (5 güne karşı 2 günü
// kıyaslamak anlamsızdı) ve TOPLAM gösteriyor, ortalama değil.
//
// İlk sürüm "takvim günü başına ortalama" hesaplıyordu ve daha kötüydü: gerçek
// veride tek bir pazartesi kaydı (30.000 TL) 3 ayın 14 pazartesisine bölünüp
// 2.142,86 gibi hiçbir şey anlatmayan bir sayı üretti — bölenin içinde
// kullanıcının kayıt tutmadığı aylar ve ayın gelmemiş günleri vardı.
// 5-e-karşı-2 problemi günleri tek tek ayırmakla zaten çözülüyor: her
// haftagünü herhangi bir pencerede aynı sayıda (13-14) geçtiği için pazartesi
// toplamı ile salı toplamı adil bir kıyas.
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function DayOfWeekProfile({ days }: { days: DayOfWeekStat[] }) {
  const t = useTranslations("analysis.weekday");
  const locale = useLocale() as AppLocale;

  const max = Math.max(...days.map((d) => d.total));
  if (max <= 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  // VURGU deseni: yalnızca en yüksek gün renkli, gerisi nötr. Önce sıraya
  // göre 5 tonluk bir turuncu rampa kullanılıyordu; iki sebeple kaldırıldı —
  // ekranda birbirine yakın çok fazla ton birikiyordu (kullanıcı bildirdi) ve
  // rehberin "color follows the entity, never its rank" kuralını ihlal
  // ediyordu. Büyüklüğü barın boyu söylüyor; renk yalnızca "asıl gün bu"
  // diyor.
  const peakDay = days.reduce((best, day) => (day.total > best.total ? day : best), days[0]).isoDay;

  return (
    <ul className="flex flex-col gap-1">
      {days.map((day) => (
        <li
          key={day.isoDay}
          // group + hover: satırın tamamı dokunma/imleç hedefi, bar ve tutar
          // birlikte tepki veriyor. Kullanıcı istedi ("bir hover animasyonu
          // falan koyamıyor muyuz").
          className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/50"
        >
          <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            {t(`day.${WEEKDAY_KEYS[day.isoDay - 1]}`)}
          </span>
          <span className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full transition-all duration-300 ease-out group-hover:brightness-125 ${
                day.isoDay === peakDay ? "bg-viz-spending" : "bg-foreground/25"
              }`}
              style={{ width: `${Math.max((day.total / max) * 100, day.total > 0 ? 2 : 0)}%` }}
            />
          </span>
          <span className="text-right text-sm font-medium tabular-nums text-foreground">
            {formatCurrency(day.total, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}
