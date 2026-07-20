"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Check, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAssumedRate, type UpdateAssumedRateState } from "@/lib/actions/profile";
import { periodFloatGain, projectBalance, projectOptimizedBalance } from "@/lib/cashflow";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatPercentAbs,
  formatShortDate,
} from "@/lib/format";
import type { Entry } from "@/lib/ledger";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

const RANGE_OPTIONS = [7, 30, 90] as const;
type Range = (typeof RANGE_OPTIONS)[number];

const DAY_MS = 86_400_000;
const CHART_W = 640;
const CHART_H = 200;
const PAD_LEFT = 56;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

function parseEvdsDate(ddmmyyyy: string): Date {
  const [d, m, y] = ddmmyyyy.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function CashFlowTimeline({
  initialData,
  assumedRate,
  evdsRate,
}: {
  initialData: Entry[];
  assumedRate: number;
  evdsRate: { rate: number; asOf: string } | null;
}) {
  const { data } = useSWR<Entry[]>(ENTRIES_KEY, fetcher, { fallbackData: initialData });
  const entries = useMemo(() => data ?? [], [data]);
  const locale = useLocale() as AppLocale;
  const t = useTranslations("cashflow");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");

  const [days, setDays] = useState<Range>(30);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hitRectRef = useRef<SVGRectElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);

  const { points, events } = useMemo(() => projectBalance(entries, days), [entries, days]);
  const optimizedPoints = useMemo(
    () => projectOptimizedBalance(points, assumedRate),
    [points, assumedRate],
  );
  const today = points[0].date;

  const balances = [...points, ...optimizedPoints].map((p) => p.balance);
  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances);
  const range = maxBalance - minBalance || Math.max(Math.abs(maxBalance), 1);
  const paddedMin = minBalance - range * 0.1;
  const paddedMax = maxBalance + range * 0.1;
  const paddedRange = paddedMax - paddedMin || 1;

  const plotW = CHART_W - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const baselineY = PAD_TOP + plotH;

  const xForIndex = (i: number) => PAD_LEFT + (i / days) * plotW;
  const yForBalance = (balance: number) =>
    PAD_TOP + (1 - (balance - paddedMin) / paddedRange) * plotH;
  const dayIndexOf = (date: Date) => Math.round((date.getTime() - today.getTime()) / DAY_MS);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xForIndex(i)},${yForBalance(p.balance)}`)
    .join(" ");
  const areaPath = `${linePath} L${xForIndex(points.length - 1)},${baselineY} L${xForIndex(0)},${baselineY} Z`;
  const optimizedLinePath = optimizedPoints
    .map((p, i) => `${i === 0 ? "M" : "L"}${xForIndex(i)},${yForBalance(p.balance)}`)
    .join(" ");

  const gridCount = 4;
  const gridValues = Array.from(
    { length: gridCount + 1 },
    (_, i) => paddedMin + (paddedRange * i) / gridCount,
  );
  const xLabelIndices = [0, Math.round(days / 2), days];

  // Measures against the invisible hit <rect> itself (the plot area, i.e.
  // excluding the axis-label padding) — measuring against the whole <svg>
  // here was the bug: it made the fraction-to-day-index math run PAD_LEFT
  // pixels off, so hovering a marker showed a different day's tooltip.
  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    const hitRect = hitRectRef.current;
    if (!hitRect) return;
    const rect = hitRect.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    setHoverIndex(Math.min(days, Math.max(0, Math.round(fraction * days))));
  }

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverOptimizedPoint = hoverIndex !== null ? optimizedPoints[hoverIndex] : null;
  const hoverEvents =
    hoverIndex !== null ? events.filter((ev) => dayIndexOf(ev.occurrence) === hoverIndex) : [];

  const endGain =
    optimizedPoints[optimizedPoints.length - 1].balance - points[points.length - 1].balance;

  const [rateState, rateAction, ratePending] = useActionState<UpdateAssumedRateState, FormData>(
    updateAssumedRate,
    {},
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as Range)}
          className="min-h-touch rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {RANGE_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {t(`range.${d}`)}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-signal-buy-foreground" aria-hidden />
            {tLedger("kind.income")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-signal-caution-foreground" aria-hidden />
            {tLedger("kind.expense")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-primary" aria-hidden />
            {t("legendActual")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-primary opacity-40" aria-hidden />
            {t("legendOptimized")}
          </span>
        </div>

        <div className="relative">
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full"
            role="img"
            aria-label={t("chartAriaLabel")}
          >
            {gridValues.map((v, i) => (
              <line
                key={i}
                x1={PAD_LEFT}
                x2={CHART_W - PAD_RIGHT}
                y1={yForBalance(v)}
                y2={yForBalance(v)}
                className="stroke-border"
                strokeWidth={1}
              />
            ))}
            {gridValues.map((v, i) => (
              <text
                key={i}
                x={PAD_LEFT - 6}
                y={yForBalance(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {formatCurrencyCompact(v, locale)}
              </text>
            ))}

            <path d={areaPath} className="fill-primary" opacity={0.1} />
            <path
              d={optimizedLinePath}
              className="stroke-primary"
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="4,3"
              opacity={0.5}
            />
            <path
              d={linePath}
              className="stroke-primary"
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {events.map((ev, i) => {
              const idx = dayIndexOf(ev.occurrence);
              const point = points[idx];
              if (!point) return null;
              const isIncome = ev.entry.kind === "income";
              return (
                <circle
                  key={i}
                  cx={xForIndex(idx)}
                  cy={yForBalance(point.balance)}
                  r={5}
                  className={cn(
                    isIncome ? "fill-signal-buy-foreground" : "fill-signal-caution-foreground",
                    "stroke-background",
                  )}
                  strokeWidth={2}
                />
              );
            })}

            {hoverIndex !== null && (
              <line
                x1={xForIndex(hoverIndex)}
                x2={xForIndex(hoverIndex)}
                y1={PAD_TOP}
                y2={baselineY}
                className="stroke-muted-foreground"
                strokeWidth={1}
                strokeDasharray="2,2"
              />
            )}

            {xLabelIndices.map((idx, i) => (
              <text
                key={i}
                x={xForIndex(idx)}
                y={CHART_H - 6}
                textAnchor={idx === 0 ? "start" : idx === days ? "end" : "middle"}
                className="fill-muted-foreground text-[9px]"
              >
                {formatShortDate(points[idx].date, locale)}
              </text>
            ))}

            <rect
              ref={hitRectRef}
              x={PAD_LEFT}
              y={PAD_TOP}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIndex(null)}
              className="cursor-crosshair"
            />
          </svg>

          {hoverPoint && hoverOptimizedPoint && hoverIndex !== null && (
            <div
              className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1.5 text-xs whitespace-nowrap shadow-md"
              style={{ left: `${(xForIndex(hoverIndex) / CHART_W) * 100}%` }}
            >
              <div className="text-muted-foreground">{formatDate(hoverPoint.date, locale)}</div>
              <div className="font-medium text-foreground">
                {t("legendActual")}: {formatCurrency(hoverPoint.balance, locale)}
              </div>
              <div className="font-medium text-foreground opacity-70">
                {t("legendOptimized")}: {formatCurrency(hoverOptimizedPoint.balance, locale)}
              </div>
              {hoverEvents.map((ev, i) => {
                const isIncome = ev.entry.kind === "income";
                const gain = isIncome
                  ? null
                  : periodFloatGain(ev.entry.amount, ev.entry.recurrence, ev.occurrence, assumedRate);
                return (
                  <div key={i} className="flex flex-col">
                    <span
                      className={
                        isIncome ? "text-signal-buy-foreground" : "text-signal-caution-foreground"
                      }
                    >
                      {isIncome ? "+" : "−"}
                      {formatCurrency(ev.entry.amount, locale)}
                    </span>
                    {gain !== null && gain > 0 && (
                      <span className="text-muted-foreground">
                        {t("eventGainSentence", { gain: formatCurrency(gain, locale) })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {endGain > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("summarySentence", {
              days,
              gain: formatCurrency(endGain, locale),
            })}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
          <p className="text-muted-foreground">
            {evdsRate
              ? t("evdsContext", {
                  asOf: formatDate(parseEvdsDate(evdsRate.asOf), locale),
                  rate: formatPercentAbs(evdsRate.rate / 100, locale),
                })
              : t("evdsUnavailable")}
          </p>
          <form action={rateAction} className="flex flex-col gap-1.5">
            <label htmlFor="assumed_annual_rate" className="text-muted-foreground">
              {t("rateLabel")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                ref={rateInputRef}
                id="assumed_annual_rate"
                name="assumed_annual_rate"
                type="number"
                step="0.01"
                min="0"
                max="200"
                defaultValue={assumedRate}
                className="w-24"
              />
              <span className="text-muted-foreground">%</span>
              <Button
                type="submit"
                size="icon-touch"
                variant="outline"
                disabled={ratePending}
                aria-label={tCommon("save")}
              >
                <Check className="size-4" />
              </Button>
              {evdsRate && (
                <Button
                  type="button"
                  size="icon-touch"
                  variant="ghost"
                  aria-label={t("useEvdsRate")}
                  onClick={() => {
                    // toFixed(2), not String() — the input has step="0.01",
                    // so a raw EVDS value like 39.9123 fails the browser's
                    // native number validation and silently blocks
                    // submission (no error shown, the "submit" event never
                    // even fires) instead of saving.
                    if (rateInputRef.current) rateInputRef.current.value = evdsRate.rate.toFixed(2);
                  }}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
            </div>
          </form>
          {rateState?.error && (
            <p className="text-signal-caution-foreground">{rateState.error}</p>
          )}
          {rateState?.success && <p className="text-signal-buy-foreground">{tSettings("saved")}</p>}
          <p className="text-muted-foreground">{t("disclaimer")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
