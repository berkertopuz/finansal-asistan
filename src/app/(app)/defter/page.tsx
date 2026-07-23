import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { CashFlowTimeline } from "@/components/ledger/CashFlowTimeline";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient, getUser } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { getPositionsWithPrices } from "@/lib/positions-data";
import { fetchReferenceRate, fetchTermDepositRate } from "@/lib/providers/evds";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";

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
    user ? getPositionsWithPrices(supabase, user.id) : Promise.resolve([]),
    supabase.from("profiles").select("assumed_annual_rate").eq("id", user!.id).maybeSingle(),
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
    await supabase.from("profiles").update({ assumed_annual_rate: assumedRate }).eq("id", user!.id);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="px-4 md:px-0">
        <Card className="glass-card ring-0">
          <CardHeader>
            <CardTitle className="text-base">{t("title")}</CardTitle>
          </CardHeader>
          {/* 5 columns only from lg: up — at md: (where the desktop sidebar
              already ate 256px) sm:grid-cols-5 left each card too narrow for
              a bold ₺xxx.xxx,xx figure, wrapping/overflowing badly around
              ~773px viewports. truncate on the value is a defensive
              fallback so a future narrow case clips instead of overflowing. */}
          <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {/* col-span-2 on mobile so it reads as the headline figure,
                full-width above the other four's even 2x2 grid. Violet, not
                a specific hex the user picked directly, not a semantic
                token. */}
            <div className="glass-card col-span-2 rounded-2xl p-4 lg:col-span-1">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("netWorth")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-[#AB47BC]">
                {formatCurrency(netWorth, locale)}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("income")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-signal-buy-foreground">
                {formatCurrency(surplus.income_total, locale)}
              </p>
            </div>
            {/* Caution-amber, not signal-buy green — an expense leaving the
                account isn't a "good" signal the way income is, but it's
                also not the sell/alarm-red used elsewhere for signals, so
                this reuses the same amber CLAUDE.md already keeps for
                "pay attention to this" tones. */}
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("expense")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-signal-caution-foreground">
                {formatCurrency(surplus.expense_total, locale)}
              </p>
            </div>
            {/* Specific hex the user picked directly, not a semantic
                token. */}
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("subscription")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-[#E8E6E1]">
                {formatCurrency(surplus.subscription_total, locale)}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("netSurplus")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-blue-500 dark:text-blue-400">
                {formatCurrency(surplus.surplus, locale)}
              </p>
            </div>
          </CardContent>
        </Card>
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
