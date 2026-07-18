"use client";

import { Virtuoso } from "react-virtuoso";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { PositionCard } from "@/components/portfolio/PositionCard";
import { deletePosition } from "@/lib/actions/positions";
import type { PositionWithPrice } from "@/lib/portfolio";

export const POSITIONS_KEY = "/api/positions";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Pozisyonlar alınamadı.");
    return res.json();
  });

export function PositionList() {
  const { data, error, isLoading } = useSWR<PositionWithPrice[]>(POSITIONS_KEY, fetcher, {
    refreshInterval: 60_000, // docs/phase1-plan.md B — client island, SWR 60s
  });
  const router = useRouter();

  const handleDelete = async (id: string) => {
    mutate(
      POSITIONS_KEY,
      (current: PositionWithPrice[] | undefined) => current?.filter((p) => p.id !== id),
      false,
    );
    await deletePosition(id);
    mutate(POSITIONS_KEY);
    router.refresh();
  };

  if (isLoading) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Yükleniyor…</p>;
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-sm text-signal-caution-foreground">
        Pozisyonlar yüklenemedi. Sayfayı yenilemeyi dene.
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Henüz pozisyon yok. Sağ alttaki + düğmesiyle ilk pozisyonunu ekle.
      </p>
    );
  }

  // 50+ pozisyonda sanallaştırma (docs/phase1-plan.md E.c) — react-virtuoso,
  // az sayıda pozisyonda da sorunsuz çalışır.
  return (
    <Virtuoso
      useWindowScroll
      data={data}
      className="px-4"
      itemContent={(_index, position) => (
        <div className="pb-2">
          <PositionCard position={position} onDelete={() => handleDelete(position.id)} />
        </div>
      )}
    />
  );
}
