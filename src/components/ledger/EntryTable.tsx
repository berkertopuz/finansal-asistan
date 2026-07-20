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
import { categoryLabel, entryDisplayDate, type Entry, type EntryKind } from "@/lib/ledger";
import { categoryIcon } from "@/lib/category-icons";
import { cn } from "@/lib/utils";

const ENTRIES_KEY = "/api/entries";
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("failed to fetch entries");
    return res.json();
  });

// "created_at" isn't a clickable column header — it's only ever the
// Tümü tab's initial default (most-recently-added-first, like an activity
// feed), before the user picks one of the three real sortable columns.
type SortField = "occurred_at" | "amount" | "category" | "created_at";
type SortDir = "asc" | "desc";

function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Bugün"/"Dün" for the mobile list's day headers, falling back to a full
// date for anything older — only meaningful in the default chronological
// view (see groupByDay below), so this only ever gets called there.
function dayGroupLabel(dateStr: string, t: (key: string) => string, locale: AppLocale): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (isSameDay(date, today)) return t("table.today");
  if (isSameDay(date, yesterday)) return t("table.yesterday");
  return formatDate(dateStr, locale);
}

type MobileRow = { type: "header"; label: string } | { type: "entry"; entry: Entry };

// income = calm green, expense = warm amber, subscription = neutral —
// reuses the app's existing signal tokens (already used for buy/sell tone
// elsewhere) instead of a flat gray badge for every kind, so the column is
// scannable at a glance.
function kindBadgeClassName(kind: EntryKind): string {
  if (kind === "income") return "bg-signal-buy-bg text-signal-buy-foreground";
  if (kind === "expense") return "bg-signal-caution-bg text-signal-caution-foreground";
  return "bg-signal-hold-bg text-signal-hold-foreground";
}

export function EntryTable({
  kind,
  initialData,
  showKindColumn = true,
  monthFilter = true,
  allowAllMonths = false,
  defaultSortField = "occurred_at",
  showMonthSummary = false,
}: {
  kind?: EntryKind | EntryKind[];
  initialData?: Entry[];
  showKindColumn?: boolean;
  // Subscriptions are standing recurring items, not month-scoped
  // transactions — Abonelikler sets this false to list every subscription
  // regardless of when it was first added.
  monthFilter?: boolean;
  // Tümü: a general activity feed, not scoped to one month by default —
  // the user can still narrow to a specific month, but starts on "all".
  // Gelirler/Giderler don't pass this, so they keep defaulting to the
  // current month.
  allowAllMonths?: boolean;
  defaultSortField?: SortField;
  // The month's totals (income/expense/subscription/net), computed from
  // *all* kinds regardless of this table's own kind filter — so Giderler
  // still shows the full month picture, not just its own expense total.
  // Only rendered while a specific month is selected.
  showMonthSummary?: boolean;
}) {
  const { data, error, isLoading } = useSWR<Entry[]>(ENTRIES_KEY, fetcher, {
    fallbackData: initialData,
  });
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger");
  const tCommon = useTranslations("common");

  const [month, setMonth] = useState(allowAllMonths ? "all" : currentMonthKey());
  const [sortField, setSortField] = useState<SortField>(defaultSortField);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<Entry | null>(null);

  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;

  // entryDisplayDate, not raw occurred_at — a recurring entry's due date can
  // roll into a different month than when it was added, and filtering on
  // one date while *displaying* another (the previous version of this) is
  // exactly what made "July selected" show August-dated rows.
  const monthMatches = (e: Entry) => month === "all" || monthOf(entryDisplayDate(e)) === month;

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((e) => (kinds ? kinds.includes(e.kind) : true) && (!monthFilter || monthMatches(e)));
  }, [data, kinds, month, monthFilter]);

  const monthSummary = useMemo(() => {
    if (!data || !showMonthSummary || month === "all") return null;
    const totals = { income: 0, expense: 0, subscription: 0 };
    for (const e of data) {
      if (!monthMatches(e)) continue;
      totals[e.kind] += e.amount;
    }
    return { ...totals, net: totals.income - totals.expense - totals.subscription };
  }, [data, showMonthSummary, month]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "amount") cmp = a.amount - b.amount;
      else if (sortField === "category") cmp = (a.category ?? "").localeCompare(b.category ?? "");
      else if (sortField === "created_at") cmp = a.created_at.localeCompare(b.created_at);
      else cmp = entryDisplayDate(a).localeCompare(entryDisplayDate(b));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortField, sortDir]);

  // Day headers only make sense in date order — sorting by amount/category
  // would scatter the same day's entries apart, so those sorts fall back to
  // the plain flat list (mobileRows just has no "header" entries then).
  const mobileRows = useMemo<MobileRow[]>(() => {
    if (sortField !== "occurred_at") {
      return sorted.map((entry) => ({ type: "entry", entry }));
    }
    const rows: MobileRow[] = [];
    let lastLabel: string | null = null;
    for (const entry of sorted) {
      const label = dayGroupLabel(entryDisplayDate(entry), t, locale);
      if (label !== lastLabel) {
        rows.push({ type: "header", label });
        lastLabel = label;
      }
      rows.push({ type: "entry", entry });
    }
    return rows;
  }, [sorted, sortField, t, locale]);

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
    // pb-24 clears QuickAddFAB (fixed bottom-24 size-14 ≈ 152px of vertical
    // space above the viewport bottom on mobile) so the last row's actions
    // aren't hidden behind it when scrolled all the way down; md:pb-4 is a
    // smaller nod to the same FAB sitting bottom-8 on desktop.
    <div className="flex flex-col gap-3 pb-24 md:pb-4">
      {monthFilter && (
        <div className="flex items-center justify-between px-4 md:px-0">
          <MonthSelect value={month} onChange={setMonth} allowAll={allowAllMonths} />
        </div>
      )}

      {monthSummary && (
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4 md:px-0">
          <div className="glass-card rounded-2xl p-3">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t("summary.income")}
            </p>
            <p className="mt-1 truncate text-lg font-bold text-signal-buy-foreground">
              {formatCurrency(monthSummary.income, locale)}
            </p>
          </div>
          <div className="glass-card rounded-2xl p-3">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t("summary.expense")}
            </p>
            <p className="mt-1 truncate text-lg font-bold text-foreground">
              {formatCurrency(monthSummary.expense, locale)}
            </p>
          </div>
          <div className="glass-card rounded-2xl p-3">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t("summary.subscription")}
            </p>
            <p className="mt-1 truncate text-lg font-bold text-foreground">
              {formatCurrency(monthSummary.subscription, locale)}
            </p>
          </div>
          <div className="glass-card rounded-2xl p-3">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t("summary.netSurplus")}
            </p>
            <p
              className={cn(
                "mt-1 truncate text-lg font-bold",
                monthSummary.net >= 0 ? "text-signal-buy-foreground" : "text-signal-caution-foreground",
              )}
            >
              {formatCurrency(monthSummary.net, locale)}
            </p>
          </div>
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
                    <TableCell>{formatDate(entryDisplayDate(entry), locale)}</TableCell>
                    {showKindColumn && (
                      <TableCell>
                        <Badge variant="secondary" className={kindBadgeClassName(entry.kind)}>
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
                          size="icon"
                          aria-label={tCommon("edit")}
                          className="text-foreground/70 hover:text-foreground"
                          onClick={() => setEditingEntry(entry)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={tCommon("delete")}
                          className="text-foreground/70 hover:text-destructive"
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
              icon-touch (≥48px) since these are touch targets here. Day
              headers ("Bugün"/"Dün") come from mobileRows, which only
              inserts them when the list is in chronological order. */}
          <div className="flex flex-col gap-2 px-4 md:hidden">
            {mobileRows.map((row, i) => {
              if (row.type === "header") {
                return (
                  <p
                    key={`h-${i}`}
                    className="px-2 pt-2 text-xs font-medium tracking-widest text-muted-foreground uppercase first:pt-0"
                  >
                    {row.label}
                  </p>
                );
              }
              const entry = row.entry;
              const { Icon, colorClassName } = categoryIcon(entry.category);
              return (
                <div key={entry.id} className="glass-card flex items-center gap-3 rounded-2xl p-4">
                  <div
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-xl",
                      colorClassName,
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                    {/* One truncating line, not a row of fixed-width badges
                        crammed next to it — those don't shrink and were
                        spilling past this column onto the amount/buttons on
                        narrow screens. Kind (income/expense/subscription) is
                        already conveyed by the icon color and the amount's
                        sign, so it's dropped here rather than squeezed in. */}
                    <span className="truncate text-sm font-semibold text-foreground">
                      {categoryLabel(t, entry.category)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatDate(entryDisplayDate(entry), locale)}
                      {entry.description ? ` · ${entry.description}` : ""}
                      {entry.recurrence !== "none" ? ` · ${t(`recurrence.${entry.recurrence}`)}` : ""}
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
              );
            })}
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
