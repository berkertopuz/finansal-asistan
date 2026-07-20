import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { CashFlowTimeline } from "@/components/ledger/CashFlowTimeline";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
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
  } = await supabase.auth.getUser();

  // No rows yet this month (brand-new user) → view returns nothing, not zeros.
  const { data } = await supabase.from("v_monthly_surplus").select("*").maybeSingle();
  const surplus = (data as MonthlySurplus | null) ?? EMPTY_SURPLUS;
  const initialData = await getEntries(supabase);
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("ledger.summary");

  // Parallel again — the "vadeli not showing in production" bug that led to
  // serializing these turned out to be a missing EVDS_API_KEY env var in
  // Vercel, not EVDS dropping concurrent requests (that was never actually
  // confirmed, just the working theory at the time). Serializing cost a
  // measured ~780ms of extra document request latency on a cold cache
  // (Lighthouse). fetchLatestSeriesValue now retries once on failure as a
  // cheaper safety net against the original theory, if it was ever real.
  const [{ data: profile }, evdsRate, termDepositRate] = await Promise.all([
    supabase.from("profiles").select("assumed_annual_rate").eq("id", user!.id).maybeSingle(),
    fetchReferenceRate(),
    fetchTermDepositRate(),
  ]);

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
          {/* 4 columns only from lg: up — at md: (where the desktop sidebar
              already ate 256px) sm:grid-cols-4 left each card too narrow for
              a bold ₺xxx.xxx,xx figure, wrapping/overflowing badly around
              ~773px viewports. truncate on the value is a defensive
              fallback so a future narrow case clips instead of overflowing. */}
          <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("income")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-signal-buy-foreground">
                {formatCurrency(surplus.income_total, locale)}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("expense")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-foreground">
                {formatCurrency(surplus.expense_total, locale)}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("subscription")}
              </p>
              <p className="mt-1 truncate text-xl font-bold text-foreground">
                {formatCurrency(surplus.subscription_total, locale)}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {t("netSurplus")}
              </p>
              <p
                className={cn(
                  "mt-1 truncate text-xl font-bold",
                  surplus.surplus >= 0
                    ? "text-signal-buy-foreground"
                    : "text-signal-caution-foreground",
                )}
              >
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

      <EntryTable initialData={initialData} allowAllMonths defaultSortField="created_at" />
      <QuickAddFAB />
    </div>
  );
}
