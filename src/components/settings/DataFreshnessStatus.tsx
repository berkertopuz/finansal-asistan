"use client";

import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import type { AssetClass } from "@/lib/portfolio";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type MarketStatus = {
  latest_fetched_at: string | null;
  by_asset_class: { asset_class: AssetClass; fetched_at: string }[];
};

export function DataFreshnessStatus() {
  const { data } = useSWR<MarketStatus>("/api/market-status", fetcher, { refreshInterval: 60_000 });
  const locale = useLocale() as AppLocale;
  const t = useTranslations("settings.dataFreshness");
  const tAssetClass = useTranslations("assetClass");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!data || data.by_asset_class.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          data.by_asset_class.map((row) => (
            <div key={row.asset_class} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{tAssetClass(row.asset_class)}</span>
              <span className="text-muted-foreground">
                {formatRelative(row.fetched_at, locale)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
