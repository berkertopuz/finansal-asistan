"use client";

import { Badge } from "@/components/ui/badge";
import { formatCurrencyTRY, formatNumberTR, formatPercentTR, formatTimeTR } from "@/lib/format";
import { ASSET_CLASS_LABELS, SIGNAL_LABELS, SIGNAL_TONE } from "@/lib/recommendations";
import { SwipeToDeleteRow } from "@/components/ledger/SwipeToDeleteRow";
import type { PositionWithPrice } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export function PositionCard({
  position,
  onDelete,
}: {
  position: PositionWithPrice;
  onDelete: () => void;
}) {
  const p = position;

  return (
    <SwipeToDeleteRow onDelete={onDelete}>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{ASSET_CLASS_LABELS[p.asset_class]}</Badge>
            <span className="text-sm font-semibold text-foreground">{p.symbol}</span>
          </div>
          {p.latest_price_try !== null && p.latest_price_fetched_at ? (
            <span className="text-right text-sm text-foreground">
              {formatCurrencyTRY(p.latest_price_try)}
              <span className="ml-1 text-xs text-muted-foreground">
                · {formatTimeTR(p.latest_price_fetched_at)}
              </span>
            </span>
          ) : (
            <span className="text-xs text-signal-caution-foreground">Veri alınamadı</span>
          )}
        </div>

        {p.asset_class === "bist" && (
          <p className="text-xs text-muted-foreground">BIST fiyatları 15 dk gecikmeli.</p>
        )}

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {formatNumberTR(p.quantity, { maximumFractionDigits: 8 })} adet · maliyet{" "}
            {formatCurrencyTRY(p.avg_cost_try)}
          </span>
          {p.pl_try !== null && p.pl_percent !== null && (
            <span
              className={cn(
                "shrink-0 font-medium",
                p.pl_try >= 0 ? "text-signal-buy-foreground" : "text-signal-caution-foreground",
              )}
            >
              {p.pl_try >= 0 ? "+" : ""}
              {formatCurrencyTRY(p.pl_try)} ({formatPercentTR(p.pl_percent)})
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
              {SIGNAL_LABELS[p.signal.signal]}
            </span>
            <p className="text-xs text-muted-foreground">{p.signal.body_tr}</p>
          </div>
        )}
      </div>
    </SwipeToDeleteRow>
  );
}
