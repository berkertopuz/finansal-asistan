"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { updateAssumedRate, type UpdateAssumedRateState } from "@/lib/actions/profile";
import {
  periodFloatGain,
  projectBalance,
  projectOptimizedBalance,
  safeToLockAmount,
  termDepositGain,
} from "@/lib/cashflow";
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
const PAD_LEFT = 52;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

function parseEvdsDate(ddmmyyyy: string): Date {
  const [d, m, y] = ddmmyyyy.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function CashFlowTimeline({
  initialData,
  assumedRate,
  evdsRate,
  termDepositRate,
}: {
  initialData: Entry[];
  assumedRate: number;
  evdsRate: { rate: number; asOf: string } | null;
  termDepositRate: { rate: number; asOf: string } | null;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const hitRectRef = useRef<SVGRectElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Measures both dimensions off the container itself, not a hardcoded
    // height — the container's height is set responsively via Tailwind
    // classes (bigger on desktop, where there's room and the numbers need
    // to stay legible; smaller on mobile), and this keeps the SVG's
    // viewBox exactly matching whatever that resolves to at any
    // breakpoint, so there's never a distortion (or a "why is the chart
    // suddenly flatter on desktop" regression from a fixed JS constant).
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setChartSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure(); // synchronous up front — ResizeObserver's callback is async
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const chartW = chartSize?.width ?? 0;
  const chartH = chartSize?.height ?? 0;
  const plotW = chartW - PAD_LEFT - PAD_RIGHT;
  const plotH = chartH - PAD_TOP - PAD_BOTTOM;
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

  const gridCount = 3;
  const gridValues = Array.from(
    { length: gridCount + 1 },
    (_, i) => paddedMin + (paddedRange * i) / gridCount,
  );
  const xLabelIndices = [0, Math.round(days / 2), days];

  // Measures against the invisible hit <rect> itself (the plot area, i.e.
  // excluding the axis-label padding) — measuring against the whole <svg>
  // here was the bug: it made the fraction-to-day-index math run PAD_LEFT
  // pixels off, so hovering a marker showed a different day's tooltip.
  function indexFromPointer(clientX: number): number | null {
    const hitRect = hitRectRef.current;
    if (!hitRect) return null;
    const rect = hitRect.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    return Math.min(days, Math.max(0, Math.round(fraction * days)));
  }

  // Mouse: live crosshair that follows the pointer and clears on leave.
  // Touch has no hover state — a drag/tap instead *pins* the tooltip open
  // (handled by onPointerDown below) and pointerleave (which fires on
  // touch-end) is ignored, or the tooltip would vanish the instant a finger
  // lifts, before it could ever be read.
  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (e.pointerType === "touch") return;
    const index = indexFromPointer(e.clientX);
    if (index !== null) setHoverIndex(index);
  }
  function handlePointerDown(e: React.PointerEvent<SVGRectElement>) {
    const index = indexFromPointer(e.clientX);
    if (index !== null) setHoverIndex(index);
  }
  function handlePointerLeave(e: React.PointerEvent<SVGRectElement>) {
    if (e.pointerType === "touch") return;
    setHoverIndex(null);
  }

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverOptimizedPoint = hoverIndex !== null ? optimizedPoints[hoverIndex] : null;
  const hoverEvents =
    hoverIndex !== null ? events.filter((ev) => dayIndexOf(ev.occurrence) === hoverIndex) : [];
  const tooltipLeftPercent =
    hoverIndex !== null ? Math.min(88, Math.max(12, (xForIndex(hoverIndex) / chartW) * 100)) : 50;

  const endGain =
    optimizedPoints[optimizedPoints.length - 1].balance - points[points.length - 1].balance;

  // Term-deposit ("vadeli") scenario — a distinct, simpler alternative to
  // the daily-account line above: no bank offers a vadeli shorter than
  // ~30 days, so this only makes sense for the 30/90-day ranges. Only the
  // portion of the balance that's never touched during the window is safe
  // to lock away without an early withdrawal (which would forfeit interest
  // on a real term deposit).
  const minActualBalance = safeToLockAmount(points);
  const showTermDeposit = days >= 30 && termDepositRate !== null && minActualBalance > 0;
  const termGain = showTermDeposit
    ? termDepositGain(minActualBalance, days, termDepositRate!.rate)
    : 0;

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
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-primary" aria-hidden />
            {t("legendActual")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-primary opacity-40" aria-hidden />
            {t("legendOptimized")}
          </span>
        </div>

        <div ref={containerRef} className="relative h-44 w-full sm:h-52 md:h-64">
          {chartSize === null ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <>
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="h-full w-full touch-none"
                role="img"
                aria-label={t("chartAriaLabel")}
              >
                {gridValues.map((v, i) => (
                  <line
                    key={i}
                    x1={PAD_LEFT}
                    x2={chartW - PAD_RIGHT}
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
                    className="fill-muted-foreground text-[10px]"
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
                      r={4}
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
                    y={chartH - 6}
                    textAnchor={idx === 0 ? "start" : idx === days ? "end" : "middle"}
                    className="fill-muted-foreground text-[10px]"
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
                  onPointerDown={handlePointerDown}
                  onPointerLeave={handlePointerLeave}
                  className="cursor-crosshair"
                />
              </svg>

              {hoverPoint && hoverOptimizedPoint && hoverIndex !== null && (
                <div
                  className="pointer-events-none absolute top-0 max-w-[calc(100%-8px)] -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1.5 text-xs whitespace-nowrap shadow-md"
                  style={{ left: `${tooltipLeftPercent}%` }}
                >
                  <div className="text-foreground/70">{formatDate(hoverPoint.date, locale)}</div>
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
                          <span className="text-foreground/70">
                            {t("eventGainSentence", { gain: formatCurrency(gain, locale) })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {endGain > 0 && (
          <p className="text-sm font-medium text-foreground">
            {t("summarySentence", {
              days,
              gain: formatCurrency(endGain, locale),
            })}
          </p>
        )}

        {showTermDeposit && termGain > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">{t("termDeposit.title")}</p>
            <p className="mt-1 text-foreground/70">
              {t("termDeposit.sentence", {
                minBalance: formatCurrency(minActualBalance, locale),
                days,
                rate: formatPercentAbs(termDepositRate!.rate / 100, locale),
                asOf: formatDate(parseEvdsDate(termDepositRate!.asOf), locale),
                gain: formatCurrency(termGain, locale),
              })}
            </p>
            <p className="mt-1 text-xs text-foreground/60">{t("termDeposit.caveat")}</p>
          </div>
        )}

        <details className="group border-t border-border pt-2 text-xs">
          <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between text-foreground/70 marker:content-none [&::-webkit-details-marker]:hidden">
            <span>{t("rateDetailsToggle")}</span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>

          <div className="mt-2 flex flex-col gap-2">
            <p className="text-foreground/70">
              {evdsRate
                ? t("evdsContext", {
                    asOf: formatDate(parseEvdsDate(evdsRate.asOf), locale),
                    rate: formatPercentAbs(evdsRate.rate / 100, locale),
                  })
                : t("evdsUnavailable")}
            </p>
            <form action={rateAction} className="flex flex-col gap-1.5">
              <label htmlFor="assumed_annual_rate" className="text-foreground/70">
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
                  className="w-24 border-foreground/15 bg-muted/50"
                />
                <span className="text-foreground/70">%</span>
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
            {rateState?.success && (
              <p className="text-signal-buy-foreground">{tSettings("saved")}</p>
            )}
            <p className="text-foreground/70">{t("disclaimer")}</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
