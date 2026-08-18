import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { EntryTable } from "@/components/ledger/EntryTable";
import { CashFlowTimeline } from "@/components/ledger/CashFlowTimeline";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient, getUser } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { getPositionsWithPrices } from "@/lib/positions-data";
import { fetchReferenceRate, fetchTermDepositRate } from "@/lib/providers/evds";
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

// Placeholder from the migration — only matters until the first successful
// EVDS fetch seeds it with a real rate (see below).
const UNSEEDED_DEFAULT_RATE = 45.0;

export default async function DefterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getUser();

  // Next renders layout.tsx and page.tsx concurrently, not strictly
  // parent-then-child, so the (app) layout's redirect() can't be trusted to
  // land before this page's own queries run. Re-check here (CLAUDE.md rule 3).
  if (!user) {
    redirect("/giris");
  }

  // All independent — none of these read another's result, only the render
  // below does. Used to run serially (surplus → getEntries → positions →
  // profile/evds/termDeposit), each paying its own round trip in turn. Safe
  // to fully parallelize now: the entries materialization that getEntries()
  // triggers internally already happened once in the (app) layout before
  // this page even started rendering (and is cache()-deduped — see
  // src/lib/recurrence-materialize.ts), so there's no ordering dependency
  // left between the surplus view and getEntries.
  const [
    { data: surplusRow },
    initialData,
    positions,
    { data: profile },
    evdsRate,
    termDepositRate,
    locale,
    t,
  ] = await Promise.all([
    // No rows yet this month (brand-new user) → view returns nothing, not zeros.
    supabase.from("v_monthly_surplus").select("*").maybeSingle(),
    getEntries(supabase),
    // Every position's current worth, whether or not it was marked "funded
    // from cash" — that checkbox only controls whether a matching cash-out
    // row exists in entries (so the balance projection reflects real money
    // leaving checking); it says nothing about whether the asset itself
    // counts toward net worth. An asset you already owned before you started
    // tracking cash still belongs in mal varlığı just as much as one you
    // funded through the app. Live price × quantity where a price exists
    // (BIST/gold/crypto/FX); avg_cost_try × quantity for "manual" positions
    // and for anything whose price API happens to be down right now — a
    // fallback to what was actually paid, never a fabricated price (CLAUDE.md
    // rule 5).
    getPositionsWithPrices(supabase, user.id),
    supabase.from("profiles").select("assumed_annual_rate").eq("id", user.id).maybeSingle(),
    // The "vadeli not showing in production" bug that led to serializing
    // these turned out to be a missing EVDS_API_KEY env var in Vercel, not
    // EVDS dropping concurrent requests (that was never actually confirmed,
    // just the working theory at the time). fetchLatestSeriesValue now
    // retries once on failure as a cheaper safety net against the original
    // theory, if it was ever real.
    fetchReferenceRate(),
    fetchTermDepositRate(),
    getLocale() as Promise<AppLocale>,
    getTranslations("ledger.summary"),
  ]);
  const surplus = (surplusRow as MonthlySurplus | null) ?? EMPTY_SURPLUS;
  const totalInvestedValue = positions.reduce(
    (sum, p) => sum + (p.latest_price_try ?? p.avg_cost_try) * p.quantity,
    0,
  );

  // surplus.surplus (this month's income − expense − subscription) never
  // touches "investment" entries rows at all — v_monthly_surplus's SQL
  // simply doesn't select them — so it's added to totalInvestedValue rather
  // than reduced by it first.
  const netWorth = surplus.surplus + totalInvestedValue;

  let assumedRate = Number(
    (profile as { assumed_annual_rate: number } | null)?.assumed_annual_rate ??
      UNSEEDED_DEFAULT_RATE,
  );

  // First real render after the migration: swap the placeholder for a live
  // rate so the stored figure starts real instead of a guess.
  if (assumedRate === UNSEEDED_DEFAULT_RATE && evdsRate) {
    assumedRate = Number(evdsRate.rate.toFixed(2));
    await supabase.from("profiles").update({ assumed_annual_rate: assumedRate }).eq("id", user.id);
  }

  // Donut chart stops for the hero's Gelir/Gider/Abonelik ring — conic-gradient
  // draws clockwise from 12 o'clock by default, so each slice's end angle is
  // just the running total of the percentages before it.
  const breakdownTotal = surplus.income_total + surplus.expense_total + surplus.subscription_total;
  const incomePct = breakdownTotal > 0 ? (surplus.income_total / breakdownTotal) * 100 : 0;
  const expensePct = breakdownTotal > 0 ? (surplus.expense_total / breakdownTotal) * 100 : 0;
  const donutGradient =
    breakdownTotal > 0
      ? `conic-gradient(var(--signal-buy-foreground) 0% ${incomePct}%, var(--destructive) ${incomePct}% ${incomePct + expensePct}%, var(--signal-hold-foreground) ${incomePct + expensePct}% 100%)`
      : "var(--muted)";

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Same hero-card language as Ana Sayfa's SurplusCard (rounded-3xl
          solid bg-card, big headline number, divided income/expense list)
          instead of the old translucent glass-card tile grid — the two
          summary cards read as the same design system now. Custom accent
          hex colors (violet net worth, off-white subscription, blue net
          surplus) are kept as-is; only the container language changed, not
          the deliberately-picked palette. */}
      <div className="px-4 md:px-0">
        <div className="rounded-3xl bg-card p-6 text-card-foreground shadow-sm ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">{t("title")}</p>
          <p className="mt-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("netWorth")}
          </p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-[#AB47BC]">
            {formatCurrency(netWorth, locale)}
          </p>

          {/* A ring chart + centered net figure instead of a flat list —
              the same three amounts, but as an actual "financial
              statistics" composition rather than stacked rows. */}
          <div className="mt-6 flex items-center gap-6">
            <div className="relative size-28 shrink-0">
              <div className="absolute inset-0 rounded-full" style={{ background: donutGradient }} />
              <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-card text-center">
                <span className="text-[10px] text-muted-foreground">{t("netSurplus")}</span>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    surplus.surplus >= 0 ? "text-signal-buy-foreground" : "text-destructive",
                  )}
                >
                  {formatCurrency(surplus.surplus, locale)}
                </span>
              </div>
            </div>
            <div className="flex flex-1 flex-col divide-y divide-border/60">
              <div className="flex items-center justify-between gap-3 py-2 first:pt-0">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full bg-signal-buy-foreground" />
                  {t("income")}
                </span>
                <span className="text-sm font-semibold text-signal-buy-foreground">
                  {formatCurrency(surplus.income_total, locale)}
                </span>
              </div>
              {/* destructive (red), not signal-caution (amber) — matches
                  the red/green convention already applied on Ana Sayfa
                  (SurplusCard, QuickEntryForm's Gider/Gelir toggle,
                  EntryTable's kind badge), so "Gider" reads as the same
                  color everywhere in the app instead of amber here and red
                  there. */}
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full bg-destructive" />
                  {t("expense")}
                </span>
                <span className="text-sm font-semibold text-destructive">
                  {formatCurrency(surplus.expense_total, locale)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 py-2 last:pb-0">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2.5 shrink-0 rounded-full bg-[#E8E6E1]" />
                  {t("subscription")}
                </span>
                <span className="text-sm font-semibold text-[#E8E6E1]">
                  {formatCurrency(surplus.subscription_total, locale)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-0">
        <CashFlowTimeline
          initialData={initialData}
          assumedRate={assumedRate}
          evdsRate={evdsRate}
          termDepositRate={termDepositRate}
        />
      </div>

      <EntryTable initialData={initialData} allowAllMonths />
      <QuickAddFAB />
    </div>
  );
}
