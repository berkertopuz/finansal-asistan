"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_CLASS_LABELS } from "@/lib/recommendations";
import { formatRelativeTR } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type MarketStatus = {
  latest_fetched_at: string | null;
  by_asset_class: { asset_class: keyof typeof ASSET_CLASS_LABELS; fetched_at: string }[];
};

export function DataFreshnessStatus() {
  const { data } = useSWR<MarketStatus>("/api/market-status", fetcher, { refreshInterval: 60_000 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">
          Veri tazeliği
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!data || data.by_asset_class.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz veri yok.</p>
        ) : (
          data.by_asset_class.map((row) => (
            <div key={row.asset_class} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{ASSET_CLASS_LABELS[row.asset_class]}</span>
              <span className="text-muted-foreground">{formatRelativeTR(row.fetched_at)}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
