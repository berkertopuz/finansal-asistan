"use client";

import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { categoryLabel, type Entry, type EntryKind } from "@/lib/ledger";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

// Sorted by day-of-month (extracted from next_due_date when set, otherwise
// pushed to the end) — a lightweight "when does this recur" list, not a
// full calendar widget (the ask was "isteğe göre bir zaman çizelgesi
// gösterebiliriz" — a nice-to-have, not a heavyweight scheduling UI).
export function FixedItemsTimeline({
  kind,
  initialData,
}: {
  kind: EntryKind;
  initialData?: Entry[];
}) {
  const { data, isLoading } = useSWR<Entry[]>(ENTRIES_KEY, fetcher, { fallbackData: initialData });
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger");

  const title = kind === "income" ? t("fixedItems.incomeTitle") : t("fixedItems.expenseTitle");

  const fixedItems = (data ?? [])
    .filter((e) => e.kind === kind && e.recurrence !== "none")
    .sort((a, b) => {
      const dayA = a.next_due_date ? new Date(a.next_due_date).getDate() : 32;
      const dayB = b.next_due_date ? new Date(b.next_due_date).getDate() : 32;
      return dayA - dayB;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
        ) : fixedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("fixedItems.empty")}</p>
        ) : (
          fixedItems.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-foreground">
                  {entry.description || categoryLabel(t, entry.category)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.next_due_date
                    ? t("fixedItems.nextDue", { date: formatDate(entry.next_due_date, locale) })
                    : t("fixedItems.noDueDate")}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{t(`recurrence.${entry.recurrence}`)}</Badge>
                <span className="font-medium text-foreground">
                  {formatCurrency(entry.amount, locale)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
