"use client";

import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { formatRelative } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Matches the ≤20 dk freshness hard-gate used before any LLM call
// (docs/phase1-plan.md C) — past that, the badge itself flags staleness.
const STALE_THRESHOLD_MIN = 20;

// Named helper, not inlined in the component body — Date.now() there would
// trip React's "impure function during render" rule.
function isStale(fetchedAt: string): boolean {
  const minutesAgo = Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000);
  return minutesAgo > STALE_THRESHOLD_MIN;
}

export function StaleDataBadge() {
  const { data } = useSWR<{ latest_fetched_at: string | null }>("/api/market-status", fetcher, {
    refreshInterval: 60_000,
  });
  const locale = useLocale() as AppLocale;
  const t = useTranslations("stale");

  if (!data?.latest_fetched_at) {
    return <p className="text-xs text-muted-foreground">{t("waiting")}</p>;
  }

  const stale = isStale(data.latest_fetched_at);

  return (
    <p
      className={cn(
        "text-xs",
        stale ? "text-signal-caution-foreground" : "text-muted-foreground",
      )}
    >
      {t("updated", { time: formatRelative(data.latest_fetched_at, locale) })}
    </p>
  );
}
