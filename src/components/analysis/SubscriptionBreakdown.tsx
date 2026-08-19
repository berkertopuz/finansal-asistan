"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { SubscriptionBreakdown as Breakdown } from "@/lib/analysis";

// Abonelik kartı İKİ AYRI SAYI gösteriyor ve bu kasıtlı — ikisi farklı soruya
// cevap veriyor, tek sayıya indirmek ikisinden birini yalan yapıyor:
//
//   "Bu ay ödenen"        = v_monthly_surplus.subscription_total. Bu aya
//                           TARİHLİ somut abonelik satırlarının toplamı, yani
//                           bir olgu: ağustosta cüzdandan çıkan para.
//   "Aylık ortalama yük"  = tekrarlayan kuralların aylığa çevrilmiş toplamı.
//                           Bir oran: "bu abonelikler bana ayda ne kadara
//                           geliyor".
//
// İkisi neden ayrışıyor: yıllık bir abonelik yalnızca yıldönümü ayında tahsil
// edilir. ₺537,59'luk yıllık bir Apple aboneliği mayısta ödenirse ağustosta
// "bu ay ödenen" ₺0'dır, ama "aylık yük" ₺44,80'dir. Önceki hâlde tek bir
// sayı vardı ve başında "Aylık" yazıyordu; o etiket, aslında "bu ay ödenen"
// olan bir sayıya bir oran iddiası yüklüyordu.
//
// Kullanıcı isteği buradan çıktı: "1200 tllik yıllık bir abonelik aslında
// aylık 100 tl'ye gelir ... bunun etkisini gösterebiliriz."
//
// v_monthly_surplus'a DOKUNULMUYOR: manşet sayı hâlâ oradan geliyor, yani
// Abonelikler sayfası ve Ana Sayfa ile aynı kaynak. Ortalama yük ayrı bir
// hesap ve ayrı bir etiketle duruyor, o toplamın yerine geçmiyor.
export function SubscriptionBreakdown({
  breakdown,
  monthlyTotal,
}: {
  breakdown: Breakdown;
  monthlyTotal: number;
}) {
  const t = useTranslations("analysis.subscriptions");
  const tLedger = useTranslations("ledger.recurrence");
  const locale = useLocale() as AppLocale;

  if (monthlyTotal === 0 && breakdown.groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 1) OLGU: bu ay gerçekten ödenen. */}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">{t("paidThisMonth")}</p>
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {formatCurrency(monthlyTotal, locale)}
        </p>
        {/* Tek seferlik çekimler bu toplamın İÇİNDE — "bunun içinde" demek,
            iki sayıyı toplayıp çift saymaya çalışmayı engelliyor. */}
        {breakdown.oneOffThisMonth > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("oneOffInside")}: {formatCurrency(breakdown.oneOffThisMonth, locale)}
          </p>
        )}
      </div>

      {/* 2) ORAN: kuralların aylığa çevrilmiş yükü. Hiç kural yoksa bu bölüm
             tamamen gizleniyor — "₺0 ortalama yük" diye bir bilgi yok. */}
      {breakdown.groups.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("averageLoad")}</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">
              {formatCurrency(breakdown.recurringMonthly, locale)}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">{t("perMonth")}</span>
            </p>
          </div>

          <ul className="flex flex-col gap-1.5">
            {breakdown.groups.map((group) => {
              // Yazılan tutar ile aylık karşılığı farklıysa dönüşümü açıkça
              // gösteriyoruz ("₺537,59 → ₺44,80/ay") — kullanıcının görmek
              // istediği tam bu. Aylık aboneliklerde ikisi aynı, orada oku
              // göstermek gürültü olurdu.
              const converted = Math.abs(group.rawTotal - group.monthlyEquivalent) > 0.01;
              return (
                <li
                  key={group.recurrence}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="text-foreground">{tLedger(group.recurrence)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("ruleCount", { count: group.count })}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                    {converted && (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(group.rawTotal, locale)}
                        </span>
                        <span className="text-xs text-muted-foreground" aria-hidden>
                          →
                        </span>
                      </>
                    )}
                    <span className="font-medium text-foreground">
                      {formatCurrency(group.monthlyEquivalent, locale)}
                    </span>
                    <span className="text-xs text-muted-foreground">{t("perMonth")}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="text-sm text-muted-foreground">
            {t("rulesYearly")}: {formatCurrency(breakdown.recurringMonthly * 12, locale)}
          </p>

          {/* İki sayının neden farklı olduğunu YAZIYORUZ. Yan yana duran iki
              abonelik rakamı, sebebi söylenmezse hata gibi okunuyor. */}
          <p className="text-xs text-muted-foreground">{t("averageLoadHint")}</p>
        </div>
      )}
    </div>
  );
}
