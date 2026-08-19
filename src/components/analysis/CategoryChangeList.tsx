"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { formatCurrency, formatPercentAbs, formatSignedCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { categoryLabel } from "@/lib/ledger";
import type { CategoryChange } from "@/lib/analysis";

// DIVERGING BAR GRAFİĞİNİN YERİNE GEÇTİ. Kullanıcı geri bildirimi net:
// "geçen aya göre tablosunda ne anlatmaya çalıştın hiç anlamadım". Haklı —
// grafikte yalnızca bir barın uzunluğu vardı ve hiçbir yerde o uzunluğun
// DEĞİŞİM tutarı olduğu yazmıyordu; okuyucu onu "bu ayın harcaması" sanıyor.
// Diverging bar 5-8 kalem varken işe yarıyor, 1-2 kalemde bozuk bir grafik
// gibi görünüyor.
//
// Yerine açık bir kıyas listesi: geçen ay -> bu ay -> değişim, üç sayı da
// yazılı. Yön renk + ikon + işaretli tutar ile veriliyor, renk tek başına
// anlam taşımıyor. Grafik kütüphanesi de gerekmiyor.
export function CategoryChangeList({ changes }: { changes: CategoryChange[] }) {
  const t = useTranslations("analysis.changes");
  const tLedger = useTranslations("ledger");
  const locale = useLocale() as AppLocale;

  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {changes.slice(0, 8).map((change) => {
        const up = change.delta > 0;
        const Icon = up ? ArrowUpRight : ArrowDownRight;
        // Artış KIRMIZI, azalış YEŞİL — kullanıcı bunu açıkça istedi ve
        // artış/azalış için evrensel finans dili bu (projenin "alarm
        // kırmızısı yok" kuralı yatırım sinyalleri için, bkz. globals.css).
        // Renk tek başına anlam taşımıyor: yanında yön oku ve işaretli tutar
        // var. Ok ve yazı AYNI rengi taşıyor, ikisi bir birim olarak okunuyor.
        const toneClass = up ? "text-viz-delta-up" : "text-viz-delta-down";

        return (
          <li key={change.category} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm text-foreground">
                {categoryLabel(tLedger, change.category)}
              </span>
              {/* Üç sayının hepsi görünür: nereden nereye. */}
              <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                {change.previous === 0 ? (
                  <span>{t("newThisMonth")}</span>
                ) : (
                  <>
                    <span>{formatCurrency(change.previous, locale)}</span>
                    <ArrowRight className="size-3 shrink-0" aria-hidden />
                    <span>
                      {change.current === 0 ? t("goneThisMonth") : formatCurrency(change.current, locale)}
                    </span>
                  </>
                )}
              </span>
            </div>

            <div className={`flex shrink-0 flex-col items-end ${toneClass}`}>
              <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
                <Icon className="size-3.5 shrink-0" aria-hidden />
                {formatSignedCurrency(change.delta, locale)}
              </span>
              {/* Yüzde yalnızca tanımlıysa: geçen ay 0 ise "%sonsuz" yazmak
                  yerine hiç yazmıyoruz (bkz. deltaRatio null). */}
              {change.deltaRatio !== null && (
                <span className="text-xs tabular-nums">
                  {formatPercentAbs(Math.abs(change.deltaRatio), locale)}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
