import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Repeat, RefreshCw, CreditCard as CardIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { getCreditCards } from "@/lib/credit-cards-data";
import { formatCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";

export default async function GiderlerPage() {
  const supabase = await createClient();
  // getEntries() (materializes this month's template occurrences) runs
  // before the surplus view is read — see the same fix + explanation in
  // defter/abonelikler/page.tsx.
  const [initialData, creditCards] = await Promise.all([
    getEntries(supabase),
    getCreditCards(supabase),
  ]);
  const surplusRow = await supabase
    .from("v_monthly_surplus")
    .select("subscription_total")
    .maybeSingle();
  const fixedExpenseCount = initialData.filter(
    (e) => e.kind === "expense" && e.recurrence !== "none",
  ).length;
  const subscriptionTotal = Number(
    (surplusRow.data as { subscription_total: number } | null)?.subscription_total ?? 0,
  );
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("ledger");
  const tCreditCards = await getTranslations("creditCards");

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Full list moved to its own page (/defter/giderler/sabit) — every
          fixed expense row shown inline here, above the month's own
          transactions, was most of "this page is too tall". */}
      <div className="px-4 md:px-0">
        <Card>
          {/* Colored icon badges — three flat gray text-only cards in a row
              read as lifeless; a distinct accent per card gives the eye
              something to differentiate them by besides label text. */}
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 dark:bg-blue-400/10 dark:text-blue-400">
              <Repeat className="size-5" />
            </div>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {t("fixedItems.expenseTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-foreground">{t("fixedItems.count", { count: fixedExpenseCount })}</p>
            <Link
              href="/defter/giderler/sabit"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t("fixedItems.viewAll")}
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 md:px-0">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-400">
              <RefreshCw className="size-5" />
            </div>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {t("subscriptions.summaryTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              {/* "Bu ay ödenen", "Aylık toplam" DEĞİL: subscription_total bu aya
                  TARİHLİ abonelik satırlarının toplamı, aylık bir oran değil.
                  Eski etiket yıllık aboneliklerde yanlıştı — yılda bir kez ₺400
                  çeken bir abonelik "aylık ₺400" gibi okunuyordu (kullanıcı
                  bildirdi; aynı hata Abonelikler sayfasında da vardı, orada
                  ayrıca "aylık ortalama yük" kırılımı gösteriliyor). Bu kart
                  tek sayılık bir teaser, tam kırılım linkin ucunda. */}
              <p className="text-xs text-muted-foreground">{t("subscriptions.paidThisMonth")}</p>
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

      <div className="px-4 md:px-0">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CardIcon className="size-5" />
            </div>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {tCreditCards("summaryTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-foreground">{tCreditCards("count", { count: creditCards.length })}</p>
            <Link
              href="/defter/giderler/kartlar"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {tCreditCards("viewAll")}
            </Link>
          </CardContent>
        </Card>
      </div>

      <EntryTable kind="expense" initialData={initialData} showKindColumn={false} showMonthSummary />
      <QuickAddFAB defaultKind="expense" />
    </div>
  );
}
