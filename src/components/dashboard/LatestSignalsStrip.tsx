"use client";

import Link from "next/link";
import useSWR from "swr";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import type { Recommendation } from "@/lib/recommendations";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Öneriler alınamadı.");
    return res.json();
  });

// Top 3 only — the full list lives on /oneriler. Stacked vertically, not a
// horizontal carousel, to stay inside "yatay scroll yok" (CLAUDE.md rule 4).
export function LatestSignalsStrip() {
  const { data, error, isLoading } = useSWR<Recommendation[]>("/api/recommendations", fetcher, {
    refreshInterval: 60_000,
  });

  if (isLoading) {
    return <p className="px-4 text-sm text-muted-foreground">Yükleniyor…</p>;
  }

  if (error || !data) {
    // Non-critical on the dashboard — /oneriler has its own error state.
    return null;
  }

  if (data.length === 0) {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        Henüz öneri yok.{" "}
        <Link href="/oneriler" className="underline underline-offset-2">
          Öneriler
        </Link>{" "}
        sekmesinden ilkini oluşturabilirsin.
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
        Tüm önerileri gör
      </Link>
    </div>
  );
}
