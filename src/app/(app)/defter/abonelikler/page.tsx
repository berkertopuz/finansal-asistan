import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntryTable } from "@/components/ledger/EntryTable";
import { QuickAddFAB } from "@/components/ledger/QuickAddFAB";
import { SubscriptionBreakdown } from "@/components/analysis/SubscriptionBreakdown";
import { createClient } from "@/lib/supabase/server";
import { getEntries } from "@/lib/entries-data";
import { monthKeyOfDate, subscriptionBreakdown } from "@/lib/analysis";

export default async function AbonelikPage() {
  const supabase = await createClient();
  // Sequential, not Promise.all: getEntries() materializes this month's
  // occurrences for any template (including one just converted from a
  // one-off expense — see QuickEntryForm's "Aboneliğe çevir") before the
  // surplus view is read. Racing the two meant a freshly-converted row's
  // total sometimes didn't show up until a second refresh, since
  // v_monthly_surplus only sees concrete rows that already exist.
  const initialData = await getEntries(supabase);
  const { data } = await supabase
    .from("v_monthly_surplus")
    .select("subscription_total")
    .maybeSingle();
  const monthlyTotal = Number((data as { subscription_total: number } | null)?.subscription_total ?? 0);
  // Kuralların periyot kırılımı ve aylığa çevrilmiş yükü. subscription_total
  // "bu aya TARİHLİ abonelik satırları" demek — aylık bir ORAN değil; eskiden
  // bu sayı "Aylık toplam" diye etiketlenip 12 ile çarpılarak "Yıllık toplam"
  // üretiliyordu ve yıllık aboneliklerde tamamen yanlış çıkıyordu. Gerçek
  // veride görüldü: yıllık ₺400'lük bir netflix aboneliği "aylık ₺400, yıllık
  // ₺4.800" olarak gösteriliyordu (kullanıcı bildirdi). Doğrusu: bu ay ödenen
  // ₺400, aylık ortalama yük ₺33,33, kuralların yıllık toplamı ₺400.
  const breakdown = subscriptionBreakdown(initialData, monthKeyOfDate(new Date()));
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
          <CardContent>
            {/* Analiz sayfasıyla AYNI bileşen: "bu ay ödenen" + "aylık ortalama
                yük" + periyot dönüşümleri. İki yüzeyin aynı sayıyı iki farklı
                şekilde hesaplaması bu oturumda zaten bir hataya yol açtı, o
                yüzden gösterim de tek yerden geliyor. */}
            <SubscriptionBreakdown breakdown={breakdown} monthlyTotal={monthlyTotal} />
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
        titleField="description"
      />

      {/* "abonelik" kategorili, tekrarlayan bir kural OLMAYAN satırlar.
          Kullanıcı tek bir ekstre satırından "bu her ay tekrar edecek" diye
          otomatik bir kural uydurmadan, abonelik benzeri işlemleri yine de
          görebilsin.

          kind ARTIK İKİ DEĞER: bu listenin eski hâli yalnızca kind="expense"
          bakıyordu ve buradaki yorum "ekstreden gelen satırlar HER ZAMAN
          kind='expense'" varsayıyordu. O varsayım gerçek veride bozuldu:
          kullanıcının veritabanında kind='subscription' + recurrence='none'
          satırlar vardı (ANTHROPIC, GOOGLE One, MCAFEE — muhtemelen bir kart
          harcaması "aboneliğe çevir" akışıyla dönüştürülürken kind değişip
          recurrence 'none' kaldığı için). Bu satırlar İKİ listeye de
          girmiyordu: üstteki templatesOnly olduğu için, buradaki de kind
          eşleşmediği için. Sonuç: kullanıcı "aboneliklerim" sayfasında hiç
          göremediği kalemleri Analiz sayfasının abonelik toplamında görüyordu
          (1.635,07 TL) ve haklı olarak veritabanında silinmemiş kayıt olduğunu
          düşündü — oysa satırlar duruyordu, sadece hiçbir liste onları
          göstermiyordu.

          standaloneOnly: yukarıdaki kural listesinde görünen bir şablonun bu
          ayki somut satırı buraya DA düşmesin (aynı aboneliği iki kez
          listelemek olurdu). */}
      <h2 className="px-4 text-sm font-medium text-foreground md:px-0">
        {t("categoryTaggedSectionTitle")}
      </h2>
      <p className="px-4 text-xs text-muted-foreground md:px-0">{t("categoryTaggedSectionHint")}</p>
      <EntryTable
        kind={["expense", "subscription"]}
        category="abonelik"
        initialData={initialData}
        showKindColumn={false}
        monthFilter={false}
        standaloneOnly
        titleField="description"
      />

      <QuickAddFAB defaultKind="subscription" />
    </div>
  );
}
