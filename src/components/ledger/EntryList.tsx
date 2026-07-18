"use client";

import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { SwipeToDeleteRow } from "@/components/ledger/SwipeToDeleteRow";
import { deleteEntry } from "@/lib/actions/entries";
import { formatCurrencyTRY, formatDateTR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEFAULT_CATEGORY, type Entry } from "@/lib/ledger";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Kayıtlar alınamadı.");
    return res.json();
  });

const KIND_LABELS: Record<Entry["kind"], string> = {
  income: "Gelir",
  expense: "Gider",
  subscription: "Abonelik",
};

const RECURRENCE_LABELS: Record<Entry["recurrence"], string> = {
  none: "",
  weekly: "Haftalık",
  monthly: "Aylık",
  yearly: "Yıllık",
};

function formatDayGroupLabel(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateStr}T00:00:00`);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return "Bugün";
  if (diffDays === 1) return "Dün";
  return formatDateTR(date);
}

export function EntryList() {
  const { data, error, isLoading } = useSWR<Entry[]>(ENTRIES_KEY, fetcher);
  const router = useRouter();

  const handleDelete = async (id: string) => {
    mutate(
      ENTRIES_KEY,
      (current: Entry[] | undefined) => current?.filter((e) => e.id !== id),
      false,
    );
    await deleteEntry(id);
    mutate(ENTRIES_KEY);
    router.refresh();
  };

  if (isLoading) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Yükleniyor…</p>;
  }

  if (error) {
    return (
      <p className="px-4 py-6 text-sm text-signal-caution-foreground">
        Kayıtlar yüklenemedi. Sayfayı yenilemeyi dene.
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Henüz kayıt yok. Sağ alttaki + düğmesiyle ilk gelir/gider kaydını ekle.
      </p>
    );
  }

  const groups = new Map<string, Entry[]>();
  for (const entry of data) {
    const list = groups.get(entry.occurred_at) ?? [];
    list.push(entry);
    groups.set(entry.occurred_at, list);
  }

  return (
    <div className="flex flex-col gap-6 px-4">
      {Array.from(groups.entries()).map(([date, entries]) => (
        <div key={date} className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">
            {formatDayGroupLabel(date)}
          </h2>
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <SwipeToDeleteRow key={entry.id} onDelete={() => handleDelete(entry.id)}>
                <div className="flex flex-1 items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant={entry.kind === "income" ? "default" : "secondary"}>
                        {KIND_LABELS[entry.kind]}
                      </Badge>
                      <span className="truncate text-sm text-foreground">
                        {entry.category ?? DEFAULT_CATEGORY}
                      </span>
                      {entry.recurrence !== "none" && (
                        <Badge variant="outline" className="shrink-0">
                          {RECURRENCE_LABELS[entry.recurrence]}
                        </Badge>
                      )}
                    </div>
                    {entry.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {entry.description}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold",
                      entry.kind === "income"
                        ? "text-signal-buy-foreground"
                        : "text-foreground",
                    )}
                  >
                    {entry.kind === "income" ? "+" : "−"}
                    {formatCurrencyTRY(entry.amount)}
                  </span>
                </div>
              </SwipeToDeleteRow>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
