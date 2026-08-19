"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercentAbs } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { categoryLabel } from "@/lib/ledger";
import type { CategorySlice } from "@/lib/analysis";
import { NEUTRAL_BAR_CLASS, categoryColor } from "@/lib/analysis-colors";

// KASITLI OLARAK DONUT DEĞİL. Bu taksonomide 10 kategori var (ENTRY_CATEGORIES)
// ve kullanıcı kendi kategorilerini de ekleyebiliyor. dataviz rehberinin form
// kuralı: "~7'den fazla anlamlı sınıf -> tablo veya yatay bar, DAHA FAZLA RENK
// DEĞİL". 10 dilimli bir donut'ta hiç kimse "market mi ulaşım mı büyük"
// sorusunu okuyamaz, ve 10 ayrı hue CVD altında zaten ayırt edilemez.
//
// Yatay bar + doğrudan etiket, üstelik grafik kütüphanesi bile gerektirmiyor:
// tek seri, uzunluk büyüklüğü taşıyor, tek hue. Tooltip yok çünkü tutar ve pay
// HER SATIRDA zaten görünür — gizli bir tooltip'e gömmek erişilebilirliği
// düşürürdü.
export function CategoryBreakdown({ slices }: { slices: CategorySlice[] }) {
  const [asTable, setAsTable] = useState(false);
  const t = useTranslations("analysis.categories");
  const tLedger = useTranslations("ledger");
  const locale = useLocale() as AppLocale;

  if (slices.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  const max = slices[0].amount;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          <Table2 className="size-3.5" />
          {t("tableView")}
        </Button>
      </div>

      {asTable ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("category")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
              <TableHead className="text-right">{t("share")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slices.map((slice) => (
              <TableRow key={slice.category}>
                <TableCell>{categoryLabel(tLedger, slice.category)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(slice.amount, locale)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercentAbs(slice.share, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {slices.map((slice) => (
            <li key={slice.category} className="group flex flex-col gap-1 rounded-md px-1 py-1 transition-colors hover:bg-muted/50">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-foreground">{categoryLabel(tLedger, slice.category)}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="font-medium tabular-nums text-foreground">
                    {formatCurrency(slice.amount, locale)}
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                    {formatPercentAbs(slice.share, locale)}
                  </span>
                </span>
              </div>
              {/* Bar EN BÜYÜK kaleme göre ölçekleniyor, toplama göre değil:
                  paylar zaten sayıyla yazılı, barın işi kalemleri birbiriyle
                  kıyaslatmak. Toplama göre ölçekleseydik küçük kalemlerin
                  hepsi görünmez bir çizgiye inerdi. 4px yuvarlatılmış uç,
                  taban çizgisine sabitli — rehberin mark ölçüsü. */}
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {/* Renk KATEGORİYE sabit bağlı, sıraya değil — market her ay
                    aynı rengi taşıyor. Gerekçe ve iki başarısız denemenin
                    hikâyesi: src/lib/analysis-colors.ts. Her satırda kategori
                    adı + tutar + pay yazılı olduğu için kimlik hiçbir zaman
                    renge tek başına bırakılmıyor (paletin açık moddaki üç
                    düşük-kontrast slotu için doğrulayıcının şart koştuğu
                    "relief" bu). */}
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out group-hover:brightness-125 ${
                    categoryColor(slice.category) ? "" : NEUTRAL_BAR_CLASS
                  }`}
                  style={{
                    width: `${Math.max((slice.amount / max) * 100, 1.5)}%`,
                    backgroundColor: categoryColor(slice.category) ?? undefined,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
