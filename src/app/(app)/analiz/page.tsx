import { getLocale, getTranslations } from "next-intl/server";
import { ArrowDownRight, ArrowUpRight, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FlowChart } from "@/components/analysis/FlowChart";
import { DayOfWeekProfile } from "@/components/analysis/DayOfWeekProfile";
import { CategoryBreakdown } from "@/components/analysis/CategoryBreakdown";
import { CategoryChangeList } from "@/components/analysis/CategoryChangeList";
import { MerchantList } from "@/components/analysis/MerchantList";
import { InstallmentChart } from "@/components/analysis/InstallmentChart";
import { CommitmentMeter } from "@/components/analysis/CommitmentMeter";
import { SubscriptionBreakdown } from "@/components/analysis/SubscriptionBreakdown";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { formatCurrency, formatPercentAbs, formatSignedCurrency } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import {
  categoryBreakdown,
  categoryChanges,
  installmentPlans,
  installmentShareOfMonth,
  subscriptionBreakdown,
  monthKeyOfDate,
  monthlyFlows,
  commitmentSplit,
  recentMonthKeys,
  spendingPace,
  topMerchants,
  trimLeadingEmptyMonths,
  dayOfWeekProfile,
} from "@/lib/analysis";

// Pencere uzunlukları. 6 ay: trend okunacak kadar uzun, mobilde eksen
// etiketleri çakışmayacak kadar kısa. 3 ay: satıcı/gün analizleri için —
// tek ay çok gürültülü (bir kez gidilen yer "en sık" görünür), 12 ay ise
// artık "şu aralar" değil.
const TREND_MONTHS = 6;
const HABIT_MONTHS = 3;
const INSTALLMENT_MONTHS = 6;

// SPK uyarısı (CLAUDE.md kural 2) BURADA YOK ve olmaması doğru: o uyarı
// "her ÖNERİ yüzeyinin" en üstünde zorunlu. Bu sayfa kullanıcının kendi
// geçmiş harcamasını gösteriyor — bir yatırım önerisi değil, bir muhasebe
// özeti. Uyarıyı buraya da koymak onu anlamsız bir dekora çevirirdi.
export default async function AnalizPage() {
  const supabase = await createClient();
  const entries = await getEntries(supabase);
  const t = await getTranslations("analysis");
  const locale = (await getLocale()) as AppLocale;

  const today = new Date();
  const currentMonth = monthKeyOfDate(today);
  const trendMonths = recentMonthKeys(currentMonth, TREND_MONTHS);
  const habitMonths = recentMonthKeys(currentMonth, HABIT_MONTHS);

  // trimLeadingEmptyMonths: kullanıcının henüz kayıt girmediği aylar grafikte
  // "0 TL harcadı" gibi görünmesin (bkz. oradaki not — gerçek veriyle
  // yakalandı, olmayan bir harcama patlaması anlatıyordu).
  const flows = trimLeadingEmptyMonths(monthlyFlows(entries, trendMonths));
  const pace = spendingPace(entries, today, HABIT_MONTHS);
  const slices = categoryBreakdown(entries, currentMonth);
  const changes = categoryChanges(entries, currentMonth);
  const split = commitmentSplit(entries, currentMonth);
  const merchantsByAmount = topMerchants(entries, { months: habitMonths, by: "amount" });
  const merchantsByCount = topMerchants(entries, { months: habitMonths, by: "count" });
  const installments = installmentPlans(entries, currentMonth, INSTALLMENT_MONTHS);
  const installmentShare = installmentShareOfMonth(entries, currentMonth);
  // Abonelikler sayfasıyla AYNI kaynak (v_monthly_surplus) — bkz. karttaki not.
  // Ardışık okuma kasıtlı: getEntries() bu ayın şablon satırlarını
  // materialize ediyor, view yalnızca var olan somut satırları görüyor.
  const { data: surplus } = await supabase
    .from("v_monthly_surplus")
    .select("subscription_total")
    .maybeSingle();
  const subscriptionMonthly = Number(
    (surplus as { subscription_total: number } | null)?.subscription_total ?? 0,
  );
  // Toplam view'dan, KIRILIM entries'tan: kırılımın işi o toplamı açıklamak
  // (hangi periyottan ne kadar), ikinci bir toplam tanımı üretmek değil.
  const subs = subscriptionBreakdown(entries, currentMonth);
  const week = dayOfWeekProfile(entries, habitMonths);

  const thisMonthFlow = flows[flows.length - 1];
  const hasAnyData = flows.some((f) => f.income > 0 || f.spending > 0);

  if (!hasAnyData) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        <PageHeading title={t("title")} subtitle={t("subtitle")} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("empty.title")}</CardTitle>
            <CardDescription>{t("empty.body")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const installmentTotal = installments.months.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <PageHeading title={t("title")} subtitle={t("subtitle")} />

      {/* KPI şeridi — üç hero sayı. dataviz rehberi: "bir tutam manşet sayı ->
          stat tile satırı, gruplanmış bar grafiği DEĞİL". */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t("kpi.spentThisMonth")}
          value={formatCurrency(pace.monthToDate, locale)}
          hint={
            pace.deltaRatio === null
              ? t("kpi.paceNoBaseline")
              : pace.deltaRatio >= 0
                ? t("kpi.paceFaster", {
                    percent: formatPercentAbs(Math.abs(pace.deltaRatio), locale).replace("%", "").trim(),
                    count: HABIT_MONTHS,
                  })
                : t("kpi.paceSlower", {
                    percent: formatPercentAbs(Math.abs(pace.deltaRatio), locale).replace("%", "").trim(),
                    count: HABIT_MONTHS,
                  })
          }
          // Yön göstergesi renk + İKON + metin: renk asla tek başına anlam
          // taşımıyor (rehberin erişilebilirlik kuralı).
          tone={pace.deltaRatio === null ? "neutral" : pace.deltaRatio >= 0 ? "bad" : "good"}
        />
        <StatTile
          label={t("kpi.netThisMonth")}
          value={formatSignedCurrency(thisMonthFlow.net, locale)}
          hint={thisMonthFlow.net >= 0 ? t("kpi.netPositive") : t("kpi.netNegative")}
          tone={thisMonthFlow.net >= 0 ? "good" : "bad"}
        />
        <StatTile
          label={t("kpi.installmentThisMonth")}
          value={formatCurrency(installmentShare.installment, locale)}
          hint={
            installmentShare.installment > 0
              ? t("kpi.installmentShare", {
                  percent: formatPercentAbs(installmentShare.share, locale).replace("%", "").trim(),
                })
              : t("kpi.installmentNone")
          }
          tone="neutral"
          footnote={
            installmentShare.fromEarlierPurchases > 0
              ? t("kpi.installmentFromEarlier", {
                  amount: formatCurrency(installmentShare.fromEarlierPurchases, locale),
                })
              : undefined
          }
        />
      </div>

      {/* Gelir/gider trendi yalnızca 3+ ay veri varken ve KENDİ kartında.
          İki noktalı bir çizgi trend göstermiyor (kullanıcı bildirdi), ve
          aylık gelir/gider TOPLAMI zaten Ana Sayfa ile Defter'de var — burada
          değerli olan tek şey birden fazla ayın birlikte okunduğu eğri. */}
      {flows.length >= 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("flow.title")}</CardTitle>
            <CardDescription>{t("flow.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <FlowChart flows={flows} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("categories.title")}</CardTitle>
            <CardDescription>{t("categories.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown slices={slices} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("changes.title")}</CardTitle>
            <CardDescription>{t("changes.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryChangeList changes={changes} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("commitment.title")}</CardTitle>
          <CardDescription>{t("commitment.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CommitmentMeter split={split} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("merchants.title")}</CardTitle>
          <CardDescription>{t("merchants.description", { count: HABIT_MONTHS })}</CardDescription>
        </CardHeader>
        <CardContent>
          <MerchantList byAmount={merchantsByAmount} byCount={merchantsByCount} />
        </CardContent>
      </Card>

      {installmentTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("installments.title")}</CardTitle>
            <CardDescription>{t("installments.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t("installments.total")}:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(installmentTotal, locale)}
              </span>
            </p>
            <InstallmentChart plans={installments.plans} months={installments.months} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("subscriptions.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* İKİ sayı gösteriyor ve ikisi farklı soruya cevap veriyor:
                "bu ay ödenen" (v_monthly_surplus'tan — Abonelikler sayfası ve
                Ana Sayfa ile AYNI kaynak, ikinci bir toplam tanımı yazmıyoruz)
                ve "aylık ortalama yük" (kuralların aylığa çevrilmiş hâli).
                Neden birleştirilemezler: bileşenin başındaki not. */}
            <SubscriptionBreakdown breakdown={subs} monthlyTotal={subscriptionMonthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("weekday.title")}</CardTitle>
            <CardDescription>{t("weekday.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Hafta içi/hafta sonu İKİLİ kıyası kaldırıldı: 5 güne karşı 2
                günü kıyaslamanın anlamı yok (kullanıcı bildirdi ve "her günü
                bile gösterebiliriz" dedi). Yedi gün ayrı ayrı, takvim günü
                başına ortalama. */}
            <DayOfWeekProfile days={week} />
          </CardContent>
        </Card>
      </div>

      {/* Neyin OLMADIĞINI söylemek de analizin parçası: kullanıcı "saat bazlı
          harcama" beklerse ve bulamazsa bunu bir eksiklik sanır. Sebebi veri
          kaynağında — ne ekstreler ne defter kayıtları saat taşıyor. */}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Clock className="mt-0.5 size-3.5 shrink-0" />
        {t("noTimeOfDayNote")}
      </p>
    </div>
  );
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
  footnote,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "bad" | "neutral";
  footnote?: string;
}) {
  const Icon = tone === "bad" ? ArrowUpRight : tone === "good" ? ArrowDownRight : null;
  // Kırmızı/yeşil — turuncu değil. Buradaki "bad/good" da bir DEĞİŞİM ifade
  // ediyor ("geçmiş 3 aya göre %X fazla", "gideri gelirini aşıyor"), yani
  // CategoryChangeList ile aynı kavram; aynı kavramın sayfada iki farklı rengi
  // olmamalı. Renk yine tek başına değil: yanında yön oku ve açıklama metni var.
  const toneClass =
    tone === "bad" ? "text-viz-delta-up" : tone === "good" ? "text-viz-delta-down" : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {/* Hero sayı: proportional figures (tabular-nums yalnızca dikey
            hizalanması gereken kolonlar için — rehberin tipografi kuralı). */}
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        <p className={`flex items-start gap-1 text-xs ${toneClass}`}>
          {Icon && <Icon className="mt-px size-3.5 shrink-0" aria-hidden />}
          <span>{hint}</span>
        </p>
        {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
      </CardContent>
    </Card>
  );
}
