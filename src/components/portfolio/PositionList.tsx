"use client";

import { Virtuoso } from "react-virtuoso";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PositionCard } from "@/components/portfolio/PositionCard";
import { deletePosition } from "@/lib/actions/positions";
import { Skeleton } from "@/components/ui/skeleton";
import type { PositionWithPrice } from "@/lib/portfolio";

export const POSITIONS_KEY = "/api/positions";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch positions");
    return res.json();
  });

function PositionListSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-lg" />
      ))}
    </div>
  );
}

// initialData lets the server-rendered /portfoy page hand SWR its first
// page of results (getPositionsWithPrices, fetched server-side) so first
// paint skips the loading skeleton entirely instead of flashing it in.
export function PositionList({ initialData }: { initialData?: PositionWithPrice[] }) {
  const { data, error, isLoading } = useSWR<PositionWithPrice[]>(POSITIONS_KEY, fetcher, {
    refreshInterval: 60_000, // docs/phase1-plan.md B — client island, SWR 60s
    fallbackData: initialData,
  });
  const router = useRouter();
  const t = useTranslations("portfolio");

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
    return <PositionListSkeleton />;
  }

  if (error) {
    return <p className="px-4 py-6 text-sm text-signal-caution-foreground">{t("loadError")}</p>;
  }

  if (!data || data.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{t("empty")}</p>;
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
