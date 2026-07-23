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
  const [initialData, { data }] = await Promise.all([
    getEntries(supabase),
    supabase.from("v_monthly_surplus").select("subscription_total").maybeSingle(),
  ]);
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

      <h2 className="px-4 text-sm font-medium text-foreground md:px-0">
        {t("recurringSectionTitle")}
      </h2>
      <EntryTable
        kind="subscription"
        initialData={initialData}
        showKindColumn={false}
        monthFilter={false}
        templatesOnly
      />

      {/* Ekstre içe aktarmadan gelen "abonelik" kategorili tek seferlik
          harcamalar (src/lib/actions/statements.ts) her zaman kind="expense",
          recurrence="none" — yukarıdaki tekrarlayan-kural listesine hiç
          girmezler (templatesOnly=true orada), o yüzden ayrı bir bölüm:
          kullanıcı tek bir ekstre satırından "bu her ay tekrar edecek" diye
          otomatik bir kural uydurmadan, kart harcamalarındaki abonelik
          benzeri işlemleri yine de görebilsin. */}
      <h2 className="px-4 text-sm font-medium text-foreground md:px-0">
        {t("categoryTaggedSectionTitle")}
      </h2>
      <p className="px-4 text-xs text-muted-foreground md:px-0">{t("categoryTaggedSectionHint")}</p>
      <EntryTable
        kind="expense"
        category="abonelik"
        initialData={initialData}
        showKindColumn={false}
        monthFilter={false}
      />

      <QuickAddFAB defaultKind="subscription" />
    </div>
  );
}
