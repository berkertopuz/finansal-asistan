import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { CashFlowTimeline } from "@/components/ledger/CashFlowTimeline";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { fetchReferenceRate } from "@/lib/providers/evds";
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

  const [{ data: profile }, evdsRate] = await Promise.all([
    supabase.from("profiles").select("assumed_annual_rate").eq("id", user!.id).maybeSingle(),
    fetchReferenceRate(),
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
        <CashFlowTimeline initialData={initialData} assumedRate={assumedRate} evdsRate={evdsRate} />
      </div>

      <div className="px-4 md:px-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">{t("income")}</p>
              <p className="text-lg font-semibold text-signal-buy-foreground">
                {formatCurrency(surplus.income_total, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("expense")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrency(surplus.expense_total, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("subscription")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrency(surplus.subscription_total, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("netSurplus")}</p>
              <p
                className={cn(
                  "text-xl font-semibold",
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

      <EntryTable initialData={initialData} />
      <QuickAddFAB />
    </div>
  );
}
