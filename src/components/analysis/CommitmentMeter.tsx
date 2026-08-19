"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCurrency, formatPercentAbs } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { CommitmentSplit } from "@/lib/analysis";

// ZORUNLU/KEYFİ ayrımının yerini aldı. Kullanıcı eski hâli haklı olarak
// reddetti: "markette aldığımız her şey zorunlu ihtiyaç değil, turistik bir
// uçak bileti de zorunlu değil". Aynı kategori hem zorunlu hem keyfi kalem
// taşıyor, dolayısıyla kategoriden zorunluluk çıkarmak yapısal olarak yanlış —
// ve o yargıyı vermek zaten bize düşmez.
//
// Yeni ayrım yargı değil YAPI (bkz. lib/analysis.ts isCommitted): taahhüt
// altındaki para ile bu ay karar verilen para. Veri bunu kesin biliyor,
// kullanıcı da kısılabilecek kısmın hangisi olduğunu kendisi bilir.
//
// İki segment tek meter'da, aralarında yüzey boşluğu. Renk tek başına anlam
// taşımıyor: her segment nokta + etiket + açıklama + tutar + yüzde ile yazılı.
export function CommitmentMeter({ split }: { split: CommitmentSplit }) {
  const t = useTranslations("analysis.commitment");
  const locale = useLocale() as AppLocale;

  if (split.total === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  const segments = [
    {
      key: "committed",
      amount: split.committed,
      // Taahhütlü kısım NÖTR: "kötü" değil, sadece bu ay değiştirilemez.
      className: "bg-viz-neutral",
      label: t("committed"),
      hint: t("committedHint"),
    },
    {
      key: "discretionary",
      amount: split.discretionary,
      // Bu ayın kararları vurgulu: kullanıcının üzerinde gücü olan kısım.
      className: "bg-viz-spending",
      label: t("discretionary"),
      hint: t("discretionaryHint"),
    },
  ].filter((segment) => segment.amount > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={`h-full first:rounded-l-full last:rounded-r-full ${segment.className}`}
            style={{ width: `${(segment.amount / split.total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-3">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-start gap-2">
              <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${segment.className}`} aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-foreground">{segment.label}</span>
                <span className="text-xs text-muted-foreground">{segment.hint}</span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="text-sm font-medium tabular-nums text-foreground">
                {formatCurrency(segment.amount, locale)}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatPercentAbs(segment.amount / split.total, locale)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
