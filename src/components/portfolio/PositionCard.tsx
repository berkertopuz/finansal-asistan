"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber, formatPercent, formatTime } from "@/lib/format";
import { SIGNAL_TONE } from "@/lib/recommendations";
import { SwipeToDeleteRow } from "@/components/ledger/SwipeToDeleteRow";
import type { PositionWithPrice } from "@/lib/portfolio";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function PositionCard({
  position,
  onDelete,
}: {
  position: PositionWithPrice;
  onDelete: () => void;
}) {
  const p = position;
  const locale = useLocale() as AppLocale;
  const tAssetClass = useTranslations("assetClass");
  const tPortfolio = useTranslations("portfolio");
  const tRec = useTranslations("recommendations");

  return (
    <SwipeToDeleteRow onDelete={onDelete}>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{tAssetClass(p.asset_class)}</Badge>
            <span className="text-sm font-semibold text-foreground">{p.symbol}</span>
            {p.funded_from_cash && (
              <Badge variant="outline" className="text-muted-foreground">
                {tPortfolio("fundedFromCashBadge")}
              </Badge>
            )}
          </div>
          {p.latest_price_try !== null && p.latest_price_fetched_at ? (
            <span className="text-right text-sm text-foreground">
              {formatCurrency(p.latest_price_try, locale)}
              <span className="ml-1 text-xs text-muted-foreground">
                · {formatTime(p.latest_price_fetched_at, locale)}
              </span>
            </span>
          ) : p.asset_class === "manual" ? (
            <span className="text-xs text-muted-foreground">{tPortfolio("manualNoPriceNote")}</span>
          ) : (
            <span className="text-xs text-signal-caution-foreground">
              {tPortfolio("priceUnavailable")}
            </span>
          )}
        </div>

        {p.asset_class === "bist" && (
          <p className="text-xs text-muted-foreground">{tPortfolio("bistDelayNote")}</p>
        )}

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {formatNumber(p.quantity, locale, { maximumFractionDigits: 8 })}{" "}
            {tPortfolio("quantitySuffix")} · {tPortfolio("costPrefix")}{" "}
            {formatCurrency(p.avg_cost_try, locale)}
          </span>
          {p.pl_try !== null && p.pl_percent !== null && (
            <span
              className={cn(
                "shrink-0 font-medium",
                p.pl_try >= 0 ? "text-signal-buy-foreground" : "text-signal-caution-foreground",
              )}
            >
              {p.pl_try >= 0 ? "+" : ""}
              {formatCurrency(p.pl_try, locale)} ({formatPercent(p.pl_percent, locale)})
            </span>
          )}
        </div>

        {p.signal && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium",
                SIGNAL_TONE[p.signal.signal],
              )}
            >
              {tRec(`signal.${p.signal.signal}`)}
            </span>
            <p className="text-xs text-muted-foreground">{p.signal.body}</p>
          </div>
        )}
      </div>
    </SwipeToDeleteRow>
  );
}
