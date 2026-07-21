import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";

export default async function AbonelikPage() {
  const supabase = await createClient();
  const initialData = await getEntries(supabase);
  const { data } = await supabase
    .from("v_monthly_surplus")
    .select("subscription_total")
    .maybeSingle();
  const monthlyTotal = Number((data as { subscription_total: number } | null)?.subscription_total ?? 0);
  const yearlyTotal = monthlyTotal * 12;
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("ledger.subscriptions");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="px-4 md:px-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {t("summaryTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{t("monthlyTotal")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrency(monthlyTotal, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("yearlyTotal")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrency(yearlyTotal, locale)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <EntryTable
        kind="subscription"
        initialData={initialData}
        showKindColumn={false}
        monthFilter={false}
        templatesOnly
      />
      <QuickAddFAB defaultKind="subscription" />
    </div>
  );
}
