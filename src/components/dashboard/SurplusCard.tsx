import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// Server component — first paint already has the number, no spinner
// (docs/phase1-plan.md B).
export async function SurplusCard() {
  const supabase = await createClient();
  const { data } = await supabase.from("v_monthly_surplus").select("*").maybeSingle();
  const surplus = (data as MonthlySurplus | null) ?? EMPTY_SURPLUS;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">
          Bu ayın net fazlası
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-3xl font-semibold",
            surplus.surplus >= 0 ? "text-signal-buy-foreground" : "text-signal-caution-foreground",
          )}
        >
          {formatCurrencyTRY(surplus.surplus)}
        </p>
        <Link
          href="/defter"
          className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-2"
        >
          Defteri gör
        </Link>
      </CardContent>
    </Card>
  );
}
