"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { MonthSelect, currentMonthKey } from "@/components/ledger/MonthSelect";
import { deleteEntry } from "@/lib/actions/entries";
import { formatCurrency, formatDate } from "@/lib/format";
import type { AppLocale } from "@/lib/locale";
import { categoryLabel, type Entry, type EntryKind } from "@/lib/ledger";
import { cn } from "@/lib/utils";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

type SortField = "occurred_at" | "amount" | "category";
type SortDir = "asc" | "desc";

function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}

export function EntryTable({
  kind,
  initialData,
  showKindColumn = true,
  monthFilter = true,
}: {
  kind?: EntryKind | EntryKind[];
  initialData?: Entry[];
  showKindColumn?: boolean;
  // Subscriptions are standing recurring items, not month-scoped
  // transactions — Abonelikler sets this false to list every subscription
  // regardless of when it was first added.
  monthFilter?: boolean;
}) {
  const { data, error, isLoading } = useSWR<Entry[]>(ENTRIES_KEY, fetcher, {
    fallbackData: initialData,
  });
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");

  const [month, setMonth] = useState(currentMonthKey());
  const [sortField, setSortField] = useState<SortField>("occurred_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<Entry | null>(null);

  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter(
      (e) => (kinds ? kinds.includes(e.kind) : true) && (!monthFilter || monthOf(e.occurred_at) === month),
    );
  }, [data, kinds, month, monthFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "amount") cmp = a.amount - b.amount;
      else if (sortField === "category") cmp = (a.category ?? "").localeCompare(b.category ?? "");
      else cmp = a.occurred_at.localeCompare(b.occurred_at);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "occurred_at" ? "desc" : "asc");
    }
  }

  async function handleConfirmDelete() {
    if (!deletingEntry) return;
    const id = deletingEntry.id;
    setDeletingEntry(null);
    mutate(ENTRIES_KEY, (current: Entry[] | undefined) => current?.filter((e) => e.id !== id), false);
    await deleteEntry(id);
    mutate(ENTRIES_KEY);
    router.refresh();
  }

  function renderSortButton(field: SortField, children: React.ReactNode) {
    const active = sortField === field;
    return (
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        {active &&
          (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {monthFilter && (
        <div className="flex items-center justify-between px-4 md:px-0">
          <MonthSelect value={month} onChange={setMonth} />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2 px-4 md:px-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-sm text-signal-caution-foreground md:px-0">
          {t("table.loadError")}
        </p>
      ) : sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground md:px-0">{t("table.empty")}</p>
      ) : (
        <>
          {/* Desktop: a real sortable table — mouse-driven, so icon-sm row
              actions are fine here (CLAUDE.md rule 4's ≥48px touch target
              only applies to touch surfaces). */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{renderSortButton("occurred_at", t("table.date"))}</TableHead>
                  {showKindColumn && <TableHead>{t("table.kind")}</TableHead>}
                  <TableHead>{renderSortButton("category", t("table.category"))}</TableHead>
                  <TableHead>{t("table.description")}</TableHead>
                  <TableHead>{t("table.recurrence")}</TableHead>
                  <TableHead className="text-right">
                    {renderSortButton("amount", t("table.amount"))}
                  </TableHead>
                  <TableHead className="text-right">{t("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDate(entry.occurred_at, locale)}</TableCell>
                    {showKindColumn && (
                      <TableCell>
                        <Badge variant={entry.kind === "income" ? "default" : "secondary"}>
                          {t(`kind.${entry.kind}`)}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell>{categoryLabel(t, entry.category)}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {entry.description ?? ""}
                    </TableCell>
                    <TableCell>
                      {entry.recurrence !== "none" && (
                        <Badge variant="outline">{t(`recurrence.${entry.recurrence}`)}</Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        entry.kind === "income" ? "text-signal-buy-foreground" : "text-foreground",
                      )}
                    >
                      {entry.kind === "income" ? "+" : "−"}
                      {formatCurrency(entry.amount, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={tCommon("edit")}
                          onClick={() => setEditingEntry(entry)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={tCommon("delete")}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeletingEntry(entry)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: a stacked row list, not the same table shrunk down —
              a <table> with 7 columns forces horizontal scroll on a 375px
              viewport, which CLAUDE.md rule 4 forbids. Row actions use
              icon-touch (≥48px) since these are touch targets here. */}
          <div className="flex flex-col gap-2 px-4 md:hidden">
            {sorted.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {showKindColumn && (
                      <Badge variant={entry.kind === "income" ? "default" : "secondary"}>
                        {t(`kind.${entry.kind}`)}
                      </Badge>
                    )}
                    <span className="truncate text-sm text-foreground">
                      {categoryLabel(t, entry.category)}
                    </span>
                    {entry.recurrence !== "none" && (
                      <Badge variant="outline" className="shrink-0">
                        {t(`recurrence.${entry.recurrence}`)}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.occurred_at, locale)}
                    {entry.description ? ` · ${entry.description}` : ""}
                  </span>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold",
                    entry.kind === "income" ? "text-signal-buy-foreground" : "text-foreground",
                  )}
                >
                  {entry.kind === "income" ? "+" : "−"}
                  {formatCurrency(entry.amount, locale)}
                </span>
                <div className="flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    aria-label={tCommon("edit")}
                    onClick={() => setEditingEntry(entry)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    aria-label={tCommon("delete")}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeletingEntry(entry)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={editingEntry !== null} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <SheetContent
          side="bottom"
          className="sm:inset-x-auto sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
        >
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
            <DialogDescription>{tCommon("confirmDelete")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingEntry(null)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDelete}>
              {tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
