import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryList } from "@/components/ledger/EntryList";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyTRY } from "@/lib/format";
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

export default async function DefterPage() {
  const supabase = await createClient();
  // No rows yet this month (brand-new user) → view returns nothing, not zeros.
  const { data } = await supabase.from("v_monthly_surplus").select("*").maybeSingle();
  const surplus = (data as MonthlySurplus | null) ?? EMPTY_SURPLUS;

  return (
    <div className="flex flex-1 flex-col gap-6 py-6 md:px-6">
      <div className="px-4 md:px-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bu ayın özeti</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Gelir</p>
              <p className="text-lg font-semibold text-signal-buy-foreground">
                {formatCurrencyTRY(surplus.income_total)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Gider</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrencyTRY(surplus.expense_total)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Abonelik</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrencyTRY(surplus.subscription_total)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net fazla</p>
              <p
                className={cn(
                  "text-xl font-semibold",
                  surplus.surplus >= 0
                    ? "text-signal-buy-foreground"
                    : "text-signal-caution-foreground",
                )}
              >
                {formatCurrencyTRY(surplus.surplus)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <EntryList />
      <QuickAddFAB />
    </div>
  );
}
