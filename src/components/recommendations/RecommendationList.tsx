"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { RecommendationCard } from "./RecommendationCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { Recommendation } from "@/lib/recommendations";

export const RECOMMENDATIONS_KEY = "/api/recommendations";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch recommendations");
    return res.json();
  });

function RecommendationListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-lg" />
      ))}
    </div>
  );
}

// initialData lets the server-rendered /oneriler page hand SWR its first
// page of results so first paint skips the loading skeleton entirely.
export function RecommendationList({ initialData }: { initialData?: Recommendation[] }) {
  const { data, error, isLoading } = useSWR<Recommendation[]>(RECOMMENDATIONS_KEY, fetcher, {
    fallbackData: initialData,
  });
  const t = useTranslations("recommendations");

  if (isLoading) {
    return <RecommendationListSkeleton />;
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-sm text-signal-caution-foreground">{t("loadError")}</p>
    );
  }

  if (!data || data.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3 px-4">
      {data.map((r) => (
        <RecommendationCard key={r.id} recommendation={r} />
      ))}
    </div>
  );
}
