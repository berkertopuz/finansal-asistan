"use client";

import useSWR from "swr";
import { formatRelativeTR } from "@/lib/format";
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

  if (!data?.latest_fetched_at) {
    return <p className="px-4 text-xs text-muted-foreground">Veri bekleniyor…</p>;
  }

  const stale = isStale(data.latest_fetched_at);

  return (
    <p
      className={cn(
        "px-4 text-xs",
        stale ? "text-signal-caution-foreground" : "text-muted-foreground",
      )}
    >
      Veriler {formatRelativeTR(data.latest_fetched_at)} güncellendi
    </p>
  );
}
