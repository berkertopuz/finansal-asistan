"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { MerchantStat } from "@/lib/analysis";
import { NEUTRAL_BAR_CLASS, categoryColor } from "@/lib/analysis-colors";

// Tutar ve sıklık İKİ AYRI GRAFİK değil, aynı listenin iki sıralaması —
// dataviz rehberi iki farklı ölçeği tek grafiğe (çift eksen) koymayı
// yasaklıyor, ve kullanıcı zaten ikisini aynı anda değil sırayla merak
// ediyor: "en çok nereye verdim" ve "en sık nereye gidiyorum".
export function MerchantList({
  byAmount,
  byCount,
}: {
  byAmount: MerchantStat[];
  byCount: MerchantStat[];
}) {
  const [mode, setMode] = useState<"amount" | "count">("amount");
  const t = useTranslations("analysis.merchants");
  const locale = useLocale() as AppLocale;

  const rows = mode === "amount" ? byAmount : byCount;

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  const max = mode === "amount" ? rows[0].amount : rows[0].count;

  return (
    <div className="flex flex-col gap-3">
      {/* Base UI'ın ToggleGroup'u tek seçimde de DİZİ alıyor (bkz.
          QuickEntryForm'daki mevcut kullanım) — Radix'in `type="single"` +
          string API'si değil. */}
      <ToggleGroup
        value={[mode]}
        onValueChange={(next) => next[0] && setMode(next[0] as "amount" | "count")}
        className="self-start gap-2"
      >
        <ToggleGroupItem
          value="amount"
          variant="outline"
          className="h-touch text-xs aria-pressed:border-foreground/30 aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
        >
          {t("byAmount")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="count"
          variant="outline"
          className="h-touch text-xs aria-pressed:border-foreground/30 aria-pressed:bg-foreground/10 aria-pressed:text-foreground"
        >
          {t("byCount")}
        </ToggleGroupItem>
      </ToggleGroup>

      <ol className="flex flex-col gap-2.5">
        {rows.map((merchant) => {
          const value = mode === "amount" ? merchant.amount : merchant.count;
          return (
            <li key={merchant.key} className="group flex flex-col gap-1 rounded-md px-1 py-1 transition-colors hover:bg-muted/50">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {/* Etiket, ekstrede GEÇEN haliyle gösteriliyor (gruptaki en sık
                    yazım) — normalize edilmiş anahtar yalnızca gruplama için,
                    kullanıcıya uydurulmuş bir marka adı gösterilmiyor. */}
                <span className="truncate text-foreground">{merchant.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-foreground">
                  {mode === "amount"
                    ? formatCurrency(merchant.amount, locale)
                    : t("visits", { count: merchant.count })}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {/* Satıcı barı KENDİ KATEGORİSİNİN rengini taşıyor — böylece
                    liste "en çok nereye" sorusunun yanında "ne tür harcama"
                    bilgisini de veriyor, ve renk kategori kırılımıyla aynı
                    dili konuşuyor (market her iki kartta aynı renk). */}
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out group-hover:brightness-125 ${
                    categoryColor(merchant.category) ? "" : NEUTRAL_BAR_CLASS
                  }`}
                  style={{
                    width: `${Math.max((value / max) * 100, 1.5)}%`,
                    backgroundColor: categoryColor(merchant.category) ?? undefined,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "amount"
                  ? `${t("visits", { count: merchant.count })} · ${t("average", { amount: formatCurrency(merchant.average, locale) })}`
                  : `${formatCurrency(merchant.amount, locale)} · ${t("average", { amount: formatCurrency(merchant.average, locale) })}`}
              </p>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">{t("groupingNote")}</p>
    </div>
  );
}
