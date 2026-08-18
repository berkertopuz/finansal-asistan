import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";

export default async function GelirlerPage() {
  const supabase = await createClient();
  const initialData = await getEntries(supabase);
  const fixedIncomeCount = initialData.filter(
    (e) => e.kind === "income" && e.recurrence !== "none",
  ).length;
  const t = await getTranslations("ledger");

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Full list moved to its own page (/defter/gelirler/sabit) — showing
          every fixed income row inline here, above the month's own
          transactions, was most of "this page is too tall before you see
          anything current" (same reasoning as pulling Abonelikler out from
          Giderler). */}
      <div className="px-4 md:px-0">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal-buy-bg text-signal-buy-foreground">
              <Repeat className="size-5" />
            </div>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {t("fixedItems.incomeTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-foreground">{t("fixedItems.count", { count: fixedIncomeCount })}</p>
            <Link
              href="/defter/gelirler/sabit"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t("fixedItems.viewAll")}
            </Link>
          </CardContent>
        </Card>
      </div>

      <EntryTable kind="income" initialData={initialData} showKindColumn={false} showMonthSummary />
      <QuickAddFAB defaultKind="income" />
    </div>
  );
}
