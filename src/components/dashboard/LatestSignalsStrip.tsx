"use client";

import Link from "next/link";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { Recommendation } from "@/lib/recommendations";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch recommendations");
    return res.json();
  });

// Top 3 only — the full list lives on /oneriler. Stacked vertically, not a
// horizontal carousel, to stay inside "yatay scroll yok" (CLAUDE.md rule 4).
// initialData mirrors RecommendationList's approach — the home page fetches
// server-side and hands it to SWR so first paint skips the skeleton.
export function LatestSignalsStrip({ initialData }: { initialData?: Recommendation[] }) {
  const { data, error, isLoading } = useSWR<Recommendation[]>("/api/recommendations", fetcher, {
    refreshInterval: 60_000,
    fallbackData: initialData,
  });
  const t = useTranslations("home");
  const tRecommendations = useTranslations("recommendations");

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 px-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    // Non-critical on the dashboard — /oneriler has its own error state.
    return null;
  }

  if (data.length === 0) {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        {t("emptySignals")}{" "}
        <Link href="/oneriler" className="underline underline-offset-2">
          {t("emptySignalsLink")}
        </Link>{" "}
        {t("emptySignalsSuffix")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4">
      {data.slice(0, 3).map((r) => (
        <RecommendationCard key={r.id} recommendation={r} />
      ))}
      <Link
        href="/oneriler"
        className="py-2 text-center text-xs text-muted-foreground underline underline-offset-2"
      >
        {tRecommendations("seeAll")}
      </Link>
    </div>
  );
}
