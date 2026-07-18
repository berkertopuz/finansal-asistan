"use client";

import useSWR from "swr";
import { RecommendationCard } from "./RecommendationCard";
import type { Recommendation } from "@/lib/recommendations";

export const RECOMMENDATIONS_KEY = "/api/recommendations";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Öneriler alınamadı.");
    return res.json();
  });

export function RecommendationList() {
  const { data, error, isLoading } = useSWR<Recommendation[]>(RECOMMENDATIONS_KEY, fetcher);

  if (isLoading) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Yükleniyor…</p>;
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-sm text-signal-caution-foreground">
        Öneriler yüklenemedi. Sayfayı yenilemeyi dene.
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Henüz öneri yok. Aşağıdaki Yenile düğmesiyle ilk öneri setini oluşturabilirsin.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4">
      {data.map((r) => (
        <RecommendationCard key={r.id} recommendation={r} />
      ))}
    </div>
  );
}
