import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

type MonthlySurplus = {
  income_total: number;
  expense_total: number;
  subscription_total: number;
  surplus: number;
};

const EMPTY_SURPLUS: MonthlySurplus = {
  income_total: 0,
  expense_total: 0,
  subscription_total: 0,
  surplus: 0,
};

// income = signal-buy (green), subscription = signal-hold (neutral) — same
// tokens EntryTable's kindBadgeClassName uses for the same kinds. expense
// uses destructive (red) rather than signal-caution (amber) here — asked
// for explicitly over the softer amber, which read as too close to a
// generic "caution" color rather than a clear expense marker.
const BREAKDOWN_SEGMENTS = [
  { key: "income", barClass: "bg-signal-buy-foreground", dotClass: "bg-signal-buy-foreground" },
  { key: "expense", barClass: "bg-destructive", dotClass: "bg-destructive" },
  { key: "subscription", barClass: "bg-signal-hold-foreground", dotClass: "bg-signal-hold-foreground" },
] as const;

// Server component — first paint already has the number, no spinner
// (docs/phase1-plan.md B). The hero card for Ana Sayfa: greeting + big
// surplus figure + income/expense/subscription breakdown, all from data
// this already fetched (no extra round trip beyond the display_name lookup).
export async function SurplusCard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: surplusRow } = await supabase.from("v_monthly_surplus").select("*").maybeSingle();
  const { data: profile } = user
    ? await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
    : { data: null as { display_name: string | null } | null };

  const surplus = (surplusRow as MonthlySurplus | null) ?? EMPTY_SURPLUS;
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("home");
  const tLedger = await getTranslations("ledger");

  const displayName = profile?.display_name;
  const greeting = displayName ? t("greeting", { name: displayName }) : t("greetingNoName");

  const breakdownTotal = surplus.income_total + surplus.expense_total + surplus.subscription_total;
  const amountByKey: Record<(typeof BREAKDOWN_SEGMENTS)[number]["key"], number> = {
    income: surplus.income_total,
    expense: surplus.expense_total,
    subscription: surplus.subscription_total,
  };

  // A floor so a genuinely small (but nonzero) category — subscription is
  // usually tiny next to income/expense — still shows a visible sliver
  // instead of rounding away to nothing, then renormalized so the segments
  // still add up to a full bar.
  const MIN_SEGMENT_PERCENT = 4;
  const rawPercents = BREAKDOWN_SEGMENTS.map((segment) => {
    const amount = amountByKey[segment.key];
    return amount > 0 && breakdownTotal > 0 ? (amount / breakdownTotal) * 100 : 0;
  });
  const flooredPercents = rawPercents.map((p) => (p > 0 ? Math.max(p, MIN_SEGMENT_PERCENT) : 0));
  const flooredTotal = flooredPercents.reduce((sum, p) => sum + p, 0);
  const barWidthPercents = flooredPercents.map((p) => (flooredTotal > 0 ? (p / flooredTotal) * 100 : 0));

  return (
    <div className="rounded-3xl bg-card p-6 text-card-foreground shadow-sm ring-1 ring-foreground/10">
      <p className="text-sm text-muted-foreground">{greeting}</p>
      <p className="mt-3 text-xs font-medium text-muted-foreground">{t("surplusTitle")}</p>
      <p
        className={cn(
          "mt-1 text-4xl font-semibold tracking-tight",
          // destructive, not signal-caution — a negative balance here is
          // directly caused by Gider > Gelir, so it reads as the same
          // "money going the wrong way" signal as the Gider row below it,
          // not a separate amber "caution" state.
          surplus.surplus >= 0 ? "text-signal-buy-foreground" : "text-destructive",
        )}
      >
        {formatCurrency(surplus.surplus, locale)}
      </p>

      {breakdownTotal > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {BREAKDOWN_SEGMENTS.map((segment, i) => {
              if (barWidthPercents[i] <= 0) return null;
              return (
                <div key={segment.key} className={segment.barClass} style={{ width: `${barWidthPercents[i]}%` }} />
              );
            })}
          </div>
          {/* One full-width row per kind, not a wrapped inline chip list —
              the amounts are the point here, so they get their own line and
              real font size instead of competing for space in a caption. */}
          <div className="flex flex-col divide-y divide-border/60">
            {BREAKDOWN_SEGMENTS.map((segment) => (
              <div key={segment.key} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("size-2.5 shrink-0 rounded-full", segment.dotClass)} />
                  {tLedger(`summary.${segment.key}`)}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {formatCurrency(amountByKey[segment.key], locale)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
