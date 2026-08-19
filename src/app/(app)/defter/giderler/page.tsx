import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Repeat, RefreshCw, CreditCard as CardIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { getCreditCards } from "@/lib/credit-cards-data";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/lib/locale";

// Üç özet kartı tek bir desende toplandı: ikon rozeti üstte, başlık kalın,
// tek satırlık ayrıntı altında, aksiyon en altta marka renginde. Eskiden
// başlık soluk (muted) bir CardTitle'dı ve asıl bilgi ile aksiyon aynı
// satırda yan yana duruyordu — dikey bir hiyerarşi olmadığı için üç kart da
// aynı gri bloğa benziyordu. Kartın TAMAMI link: mobilde 48px kuralına
// takılan küçük bir "Tümünü gör" metnine nişan almak gerekmiyor.
function SummaryCard({
  href,
  icon,
  iconClassName,
  title,
  detail,
  action,
}: {
  href: string;
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  detail: React.ReactNode;
  action: string;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="h-full transition-colors hover:ring-primary/40">
        <CardContent className="flex h-full flex-col gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              iconClassName,
            )}
          >
            {icon}
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="font-heading text-base font-semibold text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
          <span className="mt-auto text-sm font-medium text-primary group-hover:underline">
            {action}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

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
      <div className="grid gap-3 px-4 sm:grid-cols-2 md:px-0 lg:grid-cols-3">
        {/* Colored icon badges — three flat gray text-only cards in a row
            read as lifeless; a distinct accent per card gives the eye
            something to differentiate them by besides label text. */}
        <SummaryCard
          href="/defter/giderler/sabit"
          icon={<Repeat className="size-5" />}
          iconClassName="bg-blue-500/10 text-blue-500 dark:bg-blue-400/10 dark:text-blue-400"
          title={t("fixedItems.expenseTitle")}
          detail={t("fixedItems.count", { count: fixedExpenseCount })}
          action={t("fixedItems.viewAll")}
        />
        {/* "Bu ay ödenen", "Aylık toplam" DEĞİL: subscription_total bu aya
            TARİHLİ abonelik satırlarının toplamı, aylık bir oran değil.
            Eski etiket yıllık aboneliklerde yanlıştı — yılda bir kez ₺400
            çeken bir abonelik "aylık ₺400" gibi okunuyordu (kullanıcı
            bildirdi; aynı hata Abonelikler sayfasında da vardı, orada
            ayrıca "aylık ortalama yük" kırılımı gösteriliyor). Bu kart
            tek sayılık bir teaser, tam kırılım linkin ucunda. */}
        <SummaryCard
          href="/defter/abonelikler"
          icon={<RefreshCw className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-400"
          title={t("subscriptions.summaryTitle")}
          detail={
            <>
              {t("subscriptions.paidThisMonth")} ·{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(subscriptionTotal, locale)}
              </span>
            </>
          }
          action={t("subscriptions.viewAll")}
        />
        <SummaryCard
          href="/defter/giderler/kartlar"
          icon={<CardIcon className="size-5" />}
          iconClassName="bg-primary/10 text-primary"
          title={tCreditCards("summaryTitle")}
          detail={tCreditCards("count", { count: creditCards.length })}
          action={tCreditCards("viewAll")}
        />
      </div>

      <EntryTable kind="expense" initialData={initialData} showKindColumn={false} showMonthSummary />
      <QuickAddFAB defaultKind="expense" />
    </div>
  );
}
