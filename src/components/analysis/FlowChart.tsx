"use client";

import { useLocale, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { formatCurrencyCompact } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { MonthlyFlow } from "@/lib/analysis";
import { shortMonthLabel } from "@/components/analysis/month-label";

// Gelir ve gider AYNI birimde (TRY) olduğu için tek eksende çizilebiliyor —
// iki y ekseni kullanmak (dataviz rehberinin "#1 chart mistake" dediği şey)
// burada hem gereksiz hem yanıltıcı olurdu: makasın görsel genişliği doğrudan
// tasarrufu okutuyor, iki ölçek bunu anlamsızlaştırırdı.
export function FlowChart({ flows }: { flows: MonthlyFlow[] }) {
  const t = useTranslations("analysis.flow");
  const locale = useLocale() as AppLocale;

  const config = {
    income: { label: t("income"), color: "var(--viz-income)" },
    spending: { label: t("spending"), color: "var(--viz-spending)" },
  } satisfies ChartConfig;

  const data = flows.map((flow) => ({
    month: shortMonthLabel(flow.month, locale),
    income: flow.income,
    spending: flow.spending,
  }));

  return (
    <ChartContainer config={config} className="aspect-[16/9] w-full sm:aspect-[21/9]">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
        {/* Recessive chrome: yalnızca yatay çizgiler, hairline, dikey ızgara yok. */}
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-foreground/10" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-xs fill-muted-foreground"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatCurrencyCompact(value, locale)}
          className="text-xs fill-muted-foreground"
        />
        <ChartTooltip
          animationDuration={0}
          isAnimationActive={false}
          cursor={{ strokeDasharray: "4 4" }} content={<ChartTooltipContent indicator="line" />} />
        {/* 2 seri => legend her zaman var (kimlik asla renge tek başına
            bırakılmaz). 2px çizgi, >=8px nokta — rehberin mark ölçüleri. */}
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="income"
          type="monotone"
          stroke="var(--color-income)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
        <Line
          dataKey="spending"
          type="monotone"
          stroke="var(--color-spending)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
