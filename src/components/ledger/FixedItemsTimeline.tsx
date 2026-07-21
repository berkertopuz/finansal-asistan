"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuickEntryForm } from "@/components/ledger/QuickEntryForm";
import { deleteEntry } from "@/lib/actions/entries";
import { formatCurrency, formatDate } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { categoryLabel, type Entry, type EntryKind } from "@/lib/ledger";
import { nextOccurrenceOnOrAfter } from "@/lib/recurrence";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

// next_due_date is stored as an anchor (any past/future date establishing
// which day this recurs on), not the literal next payment — the actual
// upcoming occurrence is computed via nextOccurrenceOnOrAfter and sorted
// soonest-first. Entries without an anchor sort last.
//
// This card doubles as the *only* place a recurring rule (income/expense
// template — see src/lib/recurrence-materialize.ts) is edited or stopped.
// There's deliberately no second table for this: a standalone "recurring
// rules" list next to the month's transactions duplicated the same rows and
// read as clutter, not signal. Tapping an item here opens the same edit
// sheet the month table uses; a template always exists here even before its
// first concrete row has materialized for the current month, so it's also
// the reliable place to catch a freshly-added rule.
export function FixedItemsTimeline({
  kind,
  initialData,
}: {
  kind: EntryKind;
  initialData?: Entry[];
}) {
  const { data, isLoading } = useSWR<Entry[]>(ENTRIES_KEY, fetcher, { fallbackData: initialData });
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<Entry | null>(null);

  const title = kind === "income" ? t("fixedItems.incomeTitle") : t("fixedItems.expenseTitle");

  const now = new Date();
  const fixedItems = (data ?? [])
    .filter((e) => e.kind === kind && e.recurrence !== "none")
    .map((entry) => ({
      entry,
      nextOccurrence: entry.next_due_date
        ? nextOccurrenceOnOrAfter(entry.next_due_date, entry.recurrence, now)
        : null,
    }))
    .sort((a, b) => {
      if (!a.nextOccurrence) return 1;
      if (!b.nextOccurrence) return -1;
      return a.nextOccurrence.getTime() - b.nextOccurrence.getTime();
    });

  // Every row here is a template (fixedItems already filters to
  // recurrence !== "none"), so the delete dialog below always presents the
  // full stop-vs-delete-all choice, unlike EntryTable's version of this
  // dialog which also handles plain one-off rows.
  async function handleConfirmDelete(deleteGeneratedRows: boolean) {
    if (!deletingEntry) return;
    const id = deletingEntry.id;
    setDeletingEntry(null);
    mutate(
      ENTRIES_KEY,
      (current: Entry[] | undefined) =>
        current?.filter((e) => e.id !== id && (!deleteGeneratedRows || e.template_id !== id)),
      false,
    );
    await deleteEntry(id, deleteGeneratedRows);
    mutate(ENTRIES_KEY);
    router.refresh();
  }

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
          fixedItems.map(({ entry, nextOccurrence }) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-foreground">
                  {entry.description || categoryLabel(t, entry.category)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {nextOccurrence
                    ? t("fixedItems.nextDue", { date: formatDate(nextOccurrence, locale) })
                    : t("fixedItems.noDueDate")}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="outline">{t(`recurrence.${entry.recurrence}`)}</Badge>
                <span className="font-medium text-foreground">
                  {formatCurrency(entry.amount, locale)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  aria-label={tCommon("edit")}
                  className="text-foreground/70 hover:text-foreground"
                  onClick={() => setEditingEntry(entry)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  aria-label={tCommon("delete")}
                  className="text-foreground/70 hover:text-destructive"
                  onClick={() => setDeletingEntry(entry)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Sheet open={editingEntry !== null} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("form.editSheetTitle")}</SheetTitle>
            <SheetDescription className="sr-only">{t("form.editSheetDescription")}</SheetDescription>
          </SheetHeader>
          {editingEntry && (
            <QuickEntryForm editingEntry={editingEntry} onSaved={() => setEditingEntry(null)} />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={deletingEntry !== null} onOpenChange={(open) => !open && setDeletingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCommon("delete")}</DialogTitle>
            <DialogDescription>{t("table.deleteRecurringPrompt")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-col">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleConfirmDelete(false)}
            >
              {t("table.stopFutureOnly")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => handleConfirmDelete(true)}
            >
              {t("table.deleteAllOccurrences")}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setDeletingEntry(null)}>
              {tCommon("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
