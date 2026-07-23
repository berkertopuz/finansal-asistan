"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Clock, Pencil, Repeat, Trash2 } from "lucide-react";
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
import { categoryLabel, entryDisplayDate, toDateString, type Entry, type EntryKind } from "@/lib/ledger";
import { occurrencesInRange } from "@/lib/cashflow";
import { categoryIcon } from "@/lib/category-icons";
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

function monthStartDate(monthKey: string): Date {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
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

// A planned row is a *preview* of a future, not-yet-materialized occurrence
// of an active template — synthesized on the fly, never a real database
// row. materializeDueOccurrences now pre-generates real rows
// FUTURE_HORIZON_YEARS ahead (src/lib/recurrence-materialize.ts), so most
// months have a real row well before a user ever browses there — this only
// fills whatever narrow gap isn't covered yet (a template just added or
// edited since the last materialize pass ran, or a month past the
// horizon). plannedRows below skips any occurrence that already has a real
// row, or browsing ahead would show every recurring item twice. isPlanned
// is what tells the row renderers below to drop the edit/delete actions
// (there is nothing yet to edit or delete) and label it distinctly from a
// real, already-happened transaction.
type DisplayEntry = Entry & { isPlanned?: boolean };

type MobileRow = { type: "header"; label: string } | { type: "entry"; entry: DisplayEntry };

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
  category,
  initialData,
  showKindColumn = true,
  monthFilter = true,
  allowAllMonths = false,
  defaultSortField = "occurred_at",
  showMonthSummary = false,
  templatesOnly = false,
  titleField = "category",
}: {
  kind?: EntryKind | EntryKind[];
  // Exact category match (e.g. "abonelik") — Abonelikler uses this for a
  // second list of one-off/expense rows tagged that category (mostly from
  // ekstre içe aktarma) that aren't recurring subscription templates, so
  // they'd otherwise never show up anywhere in this page.
  category?: string;
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
  // false (default): a month-scoped transaction list — only concrete rows
  // (recurrence === "none"), whether one-off or generated from a template.
  // true: the recurring-rule manager (Abonelikler and the Gelirler/Giderler
  // "Tekrarlayan ..." sections) — only template rows (recurrence !== "none"),
  // never the per-period rows they generate. A table must never show both:
  // that would either double-count a period or, worse, let editing a
  // template's row look like it edits one month's transaction.
  templatesOnly?: boolean;
  // "category" (default) is the bold mobile-row title everywhere else, but
  // on Abonelikler every row already shares the same category ("abonelik")
  // — repeating it as the title on every single row says nothing, while the
  // description (the actual service name, e.g. "Netflix") is what's
  // distinctive. "description" swaps the two: description becomes the bold
  // title, category moves into the subtitle instead. Falls back to category
  // if description is empty (defensive — the add/edit form makes description
  // required for kind="subscription", but this guards older rows anyway).
  titleField?: "category" | "description";
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

  // The reference point entryDisplayDate rolls a recurring anchor forward
  // from. "Today" is right for an unscoped view, but browsing a specific
  // month needs that month's own start — otherwise a monthly bill can only
  // ever resolve to whichever single month contains its next occurrence
  // *from today*, and never show up when browsing further out (e.g.
  // September stays empty forever, no matter how far you navigate). Memoized
  // on `month` alone so it's a stable reference across renders, not a fresh
  // `new Date()` every time (which would defeat sorted's own memoization).
  const dateReference = useMemo(
    () => (month === "all" ? new Date() : monthStartDate(month)),
    [month],
  );

  // entryDisplayDate, not raw occurred_at — a recurring entry's due date can
  // roll into a different month than when it was added, and filtering on
  // one date while *displaying* another (the previous version of this) is
  // exactly what made "July selected" show August-dated rows.
  //
  // "Tümü" (allowAllMonths, only Defter's main tab) is a general ACTIVITY
  // FEED of what already happened, not a forward calendar — but
  // materializeDueOccurrences pre-generates FUTURE_HORIZON_YEARS of real
  // future rows per template now (src/lib/recurrence-materialize.ts), so
  // without this cutoff "Tümü" would render every one of those at once
  // (hundreds of rows for just a handful of monthly templates) instead of
  // only real, already-happened transactions. A specific month can still be
  // picked to browse ahead — this only trims the "all" default.
  const todayStr = toDateString(new Date());
  const monthMatches = (e: Entry) => {
    if (month === "all") return entryDisplayDate(e, dateReference) <= todayStr;
    return monthOf(entryDisplayDate(e, dateReference)) === month;
  };

  // Only a month strictly after the current one can ever be "planned-only"
  // — materializeDueOccurrences always covers the current month already, so
  // there's nothing to preview there (a real row already exists), and past
  // months are, well, past.
  const isFutureMonth = month !== "all" && month > currentMonthKey();

  // Synthesized preview rows for a future month, one per template
  // occurrence actually due within it — not filtered by `kinds` here (see
  // monthSummary below, which needs every kind regardless of this table's
  // own filter); `filtered` applies the kind filter when it consumes these.
  const plannedRows = useMemo<DisplayEntry[]>(() => {
    if (!data || templatesOnly || !monthFilter || !isFutureMonth) return [];
    const monthStart = monthStartDate(month);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    // (template_id, occurred_at) pairs that already have a real row —
    // materialize's multi-year horizon means most of these already exist,
    // and synthesizing a preview on top would show the same bill twice.
    const existingOccurrences = new Set(
      data.filter((e) => e.template_id).map((e) => `${e.template_id}:${e.occurred_at}`),
    );
    const rows: DisplayEntry[] = [];
    for (const tpl of data) {
      if (tpl.recurrence === "none" || !tpl.next_due_date) continue;
      for (const occurrence of occurrencesInRange(tpl.next_due_date, tpl.recurrence, monthStart, monthEnd)) {
        const occurredAt = toDateString(occurrence);
        if (existingOccurrences.has(`${tpl.id}:${occurredAt}`)) continue;
        rows.push({
          ...tpl,
          id: `planned-${tpl.id}-${occurredAt}`,
          recurrence: "none",
          next_due_date: null,
          occurred_at: occurredAt,
          template_id: tpl.id,
          isPlanned: true,
        });
      }
    }
    return rows;
  }, [data, templatesOnly, monthFilter, isFutureMonth, month]);

  const filtered = useMemo<DisplayEntry[]>(() => {
    if (!data) return [];
    const real = data.filter(
      (e) =>
        (kinds ? kinds.includes(e.kind) : true) &&
        (!category || e.category === category) &&
        (templatesOnly ? e.recurrence !== "none" : e.recurrence === "none") &&
        (!monthFilter || monthMatches(e)),
    );
    let planned = kinds ? plannedRows.filter((e) => kinds.includes(e.kind)) : plannedRows;
    if (category) planned = planned.filter((e) => e.category === category);
    return [...real, ...planned];
  }, [data, kinds, category, month, monthFilter, templatesOnly, plannedRows]);

  // Kalan taksit borcu — grup başına, henüz olmamış (occurred_at bugünden
  // ileri) satırların toplamı. `data` (SWR'ın ham, ay/kind filtresiz listesi)
  // üzerinden hesaplanır ki hangi ay/sekme görüntüleniyor olursa olsun doğru
  // kalsın. `occurred_at > today` sınırı src/lib/cashflow.ts'teki
  // currentBalance/projectBalance düzeltmesiyle aynı tanımı kullanıyor —
  // "henüz gerçekleşmemiş" aynı anlama geliyor her iki yerde de.
  const installmentRemainingByGroup = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    const today = toDateString(new Date());
    for (const e of data) {
      if (!e.installment_group_id || e.occurred_at <= today) continue;
      map.set(e.installment_group_id, (map.get(e.installment_group_id) ?? 0) + e.amount);
    }
    return map;
  }, [data]);

  const monthSummary = useMemo(() => {
    if (!data || !showMonthSummary || month === "all") return null;
    const totals = { income: 0, expense: 0, subscription: 0 };
    for (const e of data) {
      // Templates aren't a transaction themselves (see currentBalance in
      // src/lib/cashflow.ts for the same exclusion) — only the concrete
      // rows they generate count toward a month's totals.
      if (e.recurrence !== "none") continue;
      // Money moved into an investment, not spent — it reduces cash
      // (currentBalance in src/lib/cashflow.ts already accounts for that)
      // but isn't a "gider" and shouldn't skew net fazla.
      if (e.kind === "investment") continue;
      if (!monthMatches(e)) continue;
      totals[e.kind] += e.amount;
    }
    // A future month has no real rows of its own yet (see plannedRows
    // above) — without adding these in, browsing ahead to a month with a
    // standing bill due would show a flat ₺0 summary right next to the row
    // that says otherwise. plannedRows only ever come from templates, which
    // can never be kind="investment" (that kind is always a one-off cash-out
    // row, never recurring) — the guard just keeps this indexable by type.
    for (const e of plannedRows) {
      if (e.kind === "investment") continue;
      totals[e.kind] += e.amount;
    }
    return { ...totals, net: totals.income - totals.expense - totals.subscription };
  }, [data, showMonthSummary, month, plannedRows]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "amount") cmp = a.amount - b.amount;
      else if (sortField === "category") cmp = (a.category ?? "").localeCompare(b.category ?? "");
      else cmp = entryDisplayDate(a, dateReference).localeCompare(entryDisplayDate(b, dateReference));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortField, sortDir, dateReference]);

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
      const label = dayGroupLabel(entryDisplayDate(entry, dateReference), t, locale);
      if (label !== lastLabel) {
        rows.push({ type: "header", label });
        lastLabel = label;
      }
      rows.push({ type: "entry", entry });
    }
    return rows;
  }, [sorted, sortField, t, locale, dateReference]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "occurred_at" ? "desc" : "asc");
    }
  }

  async function handleConfirmDelete(deleteGeneratedRows: boolean, deleteFutureInstallments = false) {
    if (!deletingEntry) return;
    const id = deletingEntry.id;
    const installmentGroupId = deletingEntry.installment_group_id;
    const occurredAt = deletingEntry.occurred_at;
    setDeletingEntry(null);
    mutate(
      ENTRIES_KEY,
      (current: Entry[] | undefined) =>
        current?.filter((e) => {
          if (e.id === id) return false;
          if (deleteGeneratedRows && e.template_id === id) return false;
          if (
            deleteFutureInstallments &&
            installmentGroupId &&
            e.installment_group_id === installmentGroupId &&
            e.occurred_at > occurredAt
          ) {
            return false;
          }
          return true;
        }),
      false,
    );
    await deleteEntry(id, deleteGeneratedRows, deleteFutureInstallments);
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
            <p className="mt-1 truncate text-lg font-bold text-signal-caution-foreground">
              {formatCurrency(monthSummary.expense, locale)}
            </p>
          </div>
          <div className="glass-card rounded-2xl p-3">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t("summary.subscription")}
            </p>
            <p className="mt-1 truncate text-lg font-bold text-[#E8E6E1]">
              {formatCurrency(monthSummary.subscription, locale)}
            </p>
          </div>
          <div className="glass-card rounded-2xl p-3">
            <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
              {t("summary.netSurplus")}
            </p>
            <p className="mt-1 truncate text-lg font-bold text-blue-500 dark:text-blue-400">
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
                  <TableRow key={entry.id} className={cn(entry.isPlanned && "opacity-60")}>
                    <TableCell>{formatDate(entryDisplayDate(entry, dateReference), locale)}</TableCell>
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
                      {entry.isPlanned ? (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Clock className="size-3" />
                          {t("table.planned")}
                        </Badge>
                      ) : entry.recurrence !== "none" ? (
                        <Badge variant="outline">{t(`recurrence.${entry.recurrence}`)}</Badge>
                      ) : entry.installment_count ? (
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline">
                            {entry.installment_index}/{entry.installment_count}
                          </Badge>
                          {Boolean(installmentRemainingByGroup.get(entry.installment_group_id!)) && (
                            <span className="text-xs text-muted-foreground">
                              {t("table.installmentRemaining", {
                                amount: formatCurrency(
                                  installmentRemainingByGroup.get(entry.installment_group_id!)!,
                                  locale,
                                ),
                              })}
                            </span>
                          )}
                        </div>
                      ) : (
                        entry.template_id && (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <Repeat className="size-3" />
                            {t("table.fromRecurring")}
                          </Badge>
                        )
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
                      {entry.isPlanned ? (
                        <span className="text-xs text-muted-foreground">{t("table.plannedNotYet")}</span>
                      ) : entry.kind === "investment" && entry.portfolio_position_id ? (
                        <span className="text-xs text-muted-foreground">{t("table.managedFromPortfolio")}</span>
                      ) : (
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
                      )}
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
              const isManagedFromPortfolio = entry.kind === "investment" && Boolean(entry.portfolio_position_id);
              const useDescriptionAsTitle = titleField === "description" && Boolean(entry.description);
              const primaryText = useDescriptionAsTitle ? entry.description! : categoryLabel(t, entry.category);
              const secondaryPrefix = useDescriptionAsTitle ? categoryLabel(t, entry.category) : entry.description;
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "glass-card flex items-center gap-3 rounded-2xl p-4",
                    entry.isPlanned && "opacity-60",
                  )}
                >
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
                      {primaryText}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatDate(entryDisplayDate(entry, dateReference), locale)}
                      {secondaryPrefix ? ` · ${secondaryPrefix}` : ""}
                      {entry.isPlanned
                        ? ` · ${t("table.planned")}`
                        : isManagedFromPortfolio
                          ? ` · ${t("table.managedFromPortfolio")}`
                          : entry.recurrence !== "none"
                            ? ` · ${t(`recurrence.${entry.recurrence}`)}`
                            : entry.installment_count
                              ? ` · ${entry.installment_index}/${entry.installment_count}${
                                  installmentRemainingByGroup.get(entry.installment_group_id!)
                                    ? ` · ${t("table.installmentRemaining", {
                                        amount: formatCurrency(
                                          installmentRemainingByGroup.get(entry.installment_group_id!)!,
                                          locale,
                                        ),
                                      })}`
                                    : ""
                                }`
                              : entry.template_id
                                ? ` · ${t("table.fromRecurring")}`
                                : ""}
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
                  {!entry.isPlanned && (
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
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

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
            <DialogDescription>
              {deletingEntry && deletingEntry.recurrence !== "none"
                ? t("table.deleteRecurringPrompt")
                : deletingEntry?.installment_count
                  ? t("table.deleteInstallmentPrompt")
                  : tCommon("confirmDelete")}
            </DialogDescription>
          </DialogHeader>
          {deletingEntry && deletingEntry.recurrence !== "none" ? (
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
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setDeletingEntry(null)}
              >
                {tCommon("cancel")}
              </Button>
            </DialogFooter>
          ) : deletingEntry?.installment_count ? (
            <DialogFooter className="sm:flex-col">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => handleConfirmDelete(false, false)}
              >
                {t("table.deleteThisInstallmentOnly")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                onClick={() => handleConfirmDelete(false, true)}
              >
                {t("table.deleteFutureInstallments")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setDeletingEntry(null)}
              >
                {tCommon("cancel")}
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeletingEntry(null)}>
                {tCommon("cancel")}
              </Button>
              <Button type="button" variant="destructive" onClick={() => handleConfirmDelete(false)}>
                {tCommon("delete")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
