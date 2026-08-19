"use client";

import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { INSTALLMENT_OTHER_ID, type InstallmentPlan, type InstallmentPlanMonth } from "@/lib/analysis";
import { shortMonthLabel } from "@/components/analysis/month-label";

// YIĞILMIŞ (stacked) kolon, plan başına bir segment. Önceki hâli aylık TOPLAMI
// tek renkte gösteriyordu ve kullanıcı haklı olarak beğenmedi: "her bir yük
// farklı bir renkle temsil edilmeli ve üzerine gelindiğinde veya mobilde
// tıklandığında ne olduğu yazmalı". "Eylül'de 8.400 TL taksit var" tek başına
// eyleme dönük değil; hangi alışverişin ne zaman bittiğini görmek karar
// değiştiriyor.
//
// Renkler --viz-series-1..5'ten SABİT SIRAYLA alınıyor, asla döngüye
// girmiyor: 4'ten fazla plan varsa kuyruk "Diğer"e katlanıyor (dataviz
// rehberinin pazarlıksız kuralı — 6. bir hue üretmek CVD altında mevcut bir
// renkten ayırt edilemez). Palet doğrulayıcıdan iki modda da tam geçti.
//
// Mobil: ChartTooltip dokunmayla da açılıyor (Recharts'ın kendi touch
// desteği), o yüzden ayrı bir tıklama katmanı gerekmiyor — ama açıklama
// metninde kullanıcıya "dokun" dendiği için davranışın çalıştığından emin
// olmak lazım (bkz. sayfadaki description).
const SERIES_COLORS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
];
const OTHER_COLOR = "var(--viz-series-5)";

export function InstallmentChart({
  plans,
  months,
}: {
  plans: InstallmentPlan[];
  months: InstallmentPlanMonth[];
}) {
  const t = useTranslations("analysis.installments");
  const locale = useLocale() as AppLocale;

  // Plan etiketleri: ekstrede geçen açıklama. Açıklaması olmayan planlar
  // (elle girilmiş taksitli kayıtlar) NUMARALANIYOR — "Taksitli alışveriş 1",
  // "2"... Gerçek veride bu planların legend'ında ham grup ID'si ("c8ee6cc8")
  // görünüyordu; tek bir jenerik ada düşürmek de iki adsız planı ayırt
  // edilemez yapardı.
  let unnamedCount = 0;
  const labels = new Map<string, string>();
  for (const plan of plans) {
    if (plan.groupId === INSTALLMENT_OTHER_ID) labels.set(plan.groupId, t("other"));
    else if (plan.label) labels.set(plan.groupId, plan.label);
    else labels.set(plan.groupId, t("unnamed", { index: ++unnamedCount }));
  }
  const labelFor = (plan: InstallmentPlan) => labels.get(plan.groupId) ?? t("unnamed", { index: 1 });

  const config: ChartConfig = Object.fromEntries(
    plans.map((plan, i) => [
      plan.groupId,
      {
        label: labelFor(plan),
        color: plan.groupId === INSTALLMENT_OTHER_ID ? OTHER_COLOR : SERIES_COLORS[i % SERIES_COLORS.length],
      },
    ]),
  );

  // Recharts'a düz satırlar veriliyor; taksit göstergesi ("4/12") tooltip'te
  // gösterilmek üzere ayrı bir alanda taşınıyor.
  const data = months.map((month) => ({
    month: shortMonthLabel(month.month, locale),
    ...Object.fromEntries(plans.map((plan) => [plan.groupId, month.amounts[plan.groupId] ?? 0])),
    __positions: month.positions,
  }));

  return (
    <ChartContainer config={config} className="aspect-[4/3] w-full sm:aspect-[16/9]">
      <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-foreground/10" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} className="text-xs fill-muted-foreground" />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatCurrencyCompact(value, locale)}
          className="text-xs fill-muted-foreground"
        />
        <ChartTooltip
          // Tooltip GİRİŞ ANİMASYONU KAPALI. Recharts varsayılan olarak
          // tooltip'i yumuşak geçişle kaydırıyor; ayların üzerinden hızlı
          // geçerken kutu imleci geriden takip ediyor ve rahatsız edici bir
          // gecikme hissi veriyor (kullanıcı bildirdi). Bir tooltip anlık
          // olmalı — imleç neredeyse orada.
          animationDuration={0}
          isAnimationActive={false}
          cursor={false}
          // shared={false}: yığındaki TÜM segmentleri değil, yalnızca imlecin
          // üzerinde olduğu segmenti gösterir. Varsayılan davranış (shared)
          // yeşilin üzerine gelindiğinde turuncuyu da listeliyordu; kullanıcı
          // haklı olarak "yeşilin üstüne gelince sadece onun adı ve değeri
          // çıksın" dedi — bir yığın grafiğinde okuyucunun sorusu "bu segment
          // ne", "bu ayda neler var" değil (ay toplamı zaten kolonun boyu).
          shared={false}
          content={
            <ChartTooltipContent
              // hideLabel: shared={false} ile Recharts'ın tooltip "label"ı seri
              // adına dönüşüyor ve ChartTooltipContent onu kendi başlık
              // satırında basıyordu — aşağıdaki formatter da adı yazdığı için
              // etiket iki kez görünüyordu ("Taksitli alışveriş 1Taksitli
              // alışveriş 1", tarayıcıda gözlendi). Başlık satırı kapatılıp
              // tüm gösterim formatter'a bırakıldı.
              hideLabel
              // Tutarı para birimiyle, yanına "kaçıncı taksit" bilgisini
              // yazıyor — kullanıcının istediği "ne olduğu yazmalı" tam bu.
              formatter={(value, name, item) => {
                const positions = (item?.payload as { __positions?: Record<string, string> } | undefined)
                  ?.__positions;
                const position = positions?.[String(name)];
                const label = config[String(name)]?.label ?? String(name);
                return (
                  <span className="flex w-full flex-col gap-0.5">
                    <span className="text-foreground">{label as string}</span>
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-medium tabular-nums text-foreground">
                        {formatCurrency(Number(value), locale)}
                      </span>
                      {position && (
                        <span className="text-xs text-muted-foreground">
                          {t("position", { position })}
                        </span>
                      )}
                    </span>
                  </span>
                );
              }}
            />
          }
        />
        {/* >=2 seri => legend her zaman var (kimlik asla renge tek başına
            bırakılmaz). Tek plan varsa legend gereksiz, başlık yeterli. */}
        {plans.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {plans.map((plan, i) => (
          <Bar
            key={plan.groupId}
            dataKey={plan.groupId}
            stackId="load"
            fill={`var(--color-${plan.groupId})`}
            // Yığın segmentleri arasında 2px yüzey boşluğu (rehberin spacer
            // kuralı) — en üstteki segmentin ucu yuvarlatılıyor.
            radius={i === plans.length - 1 ? [4, 4, 0, 0] : 0}
            // Aktif segment vurgusu ÇERÇEVEYLE DEĞİL, saydamlıkla yapılıyor.
            //
            // Önce `stroke` denendi (var(--background), sonra kullanıcı isteğiyle
            // beyaz) ve ikisi de yanlıştı: `activeBar` yığındaki HER Bar
            // serisine ayrı ayrı uygulanıyor, Recharts bir kolonu aktif
            // işaretlediğinde tüm segmentler kendi çerçevesini çiziyor — çizgi
            // segmentlerin İÇ sınırlarına da geliyor ve kolonu ortadan kesiyor.
            // Üstüne tıklamada aktif indeks kalıcı olduğu için imleç
            // çekildikten sonra o çizgiler ekranda kalıyordu (kullanıcı
            // bildirdi: "tıklayınca saçma sapan borderlar çıkıyor").
            //
            // fillOpacity geometriye hiç dokunmuyor: hangi segmentin üzerinde
            // olduğun rengin açılmasından belli oluyor, kalıcı kalsa bile
            // ekranda anlamsız bir çizgi bırakmıyor. Segmenti kesin olarak
            // adlandıran şey zaten tooltip.
            activeBar={{ fillOpacity: 0.72 }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
