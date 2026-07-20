import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { FixedItemsTimeline } from "@/components/ledger/FixedItemsTimeline";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";

export default async function GiderlerPage() {
  const supabase = await createClient();
  const initialData = await getEntries(supabase);
  const { data } = await supabase
    .from("v_monthly_surplus")
    .select("subscription_total")
    .maybeSingle();
  const subscriptionTotal = Number((data as { subscription_total: number } | null)?.subscription_total ?? 0);
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("ledger");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="px-4 md:px-0">
        <FixedItemsTimeline kind="expense" initialData={initialData} />
      </div>

      <div className="px-4 md:px-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {t("subscriptions.summaryTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t("subscriptions.monthlyTotal")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrency(subscriptionTotal, locale)}
              </p>
            </div>
            <Link
              href="/defter/abonelikler"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t("subscriptions.viewAll")}
            </Link>
          </CardContent>
        </Card>
      </div>

      <EntryTable kind="expense" initialData={initialData} showKindColumn={false} showMonthSummary />
      <QuickAddFAB defaultKind="expense" />
    </div>
  );
}
