import { nextOccurrenceOnOrAfter } from "@/lib/recurrence";

export type EntryKind = "income" | "expense" | "subscription";
export type EntryRecurrence = "none" | "weekly" | "monthly" | "yearly";

export type Entry = {
  id: string;
  kind: EntryKind;
  amount: number;
  currency: "TRY";
  category: string | null;
  description: string | null;
  recurrence: EntryRecurrence;
  next_due_date: string | null;
  occurred_at: string;
  created_at: string;
};

// Labels come from messages/{locale}.json ("ledger" namespace) — components
// resolve via useTranslations, keyed by these values.
export const ENTRY_KINDS: EntryKind[] = ["expense", "income", "subscription"];
export const ENTRY_RECURRENCES: EntryRecurrence[] = ["none", "weekly", "monthly", "yearly"];

// Preset category chips (docs/phase1-plan.md A.1 — entries.category). The
// stored value is always this Turkish token regardless of UI locale (it's a
// stable DB key, not display text) — components translate it for display
// via t(`ledger.category.${value}`).
export const ENTRY_CATEGORIES = [
  "maaş",
  "serbest",
  "kira",
  "fatura",
  "abonelik",
  "market",
  "ulaşım",
  "diğer",
] as const;

export const DEFAULT_CATEGORY = "diğer";

type PresetCategory = (typeof ENTRY_CATEGORIES)[number];

export function isPresetCategory(value: string): value is PresetCategory {
  return (ENTRY_CATEGORIES as readonly string[]).includes(value);
}

// entry.category is always one of ENTRY_CATEGORIES in practice (the form
// only offers those as toggle chips) — this guards against legacy/unknown
// values so a missing message key never throws.
export function categoryLabel(t: (key: string) => string, category: string | null): string {
  const value = category ?? DEFAULT_CATEGORY;
  return isPresetCategory(value) ? t(`category.${value}`) : value;
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The date worth showing for a row: for a recurring entry, that's its
// payment/due date — but next_due_date is an ANCHOR (any past, present, or
// future date establishing which day it recurs on), not necessarily the
// actual upcoming occurrence, so it's rolled forward the same way
// FixedItemsTimeline already does (nextOccurrenceOnOrAfter) rather than
// shown verbatim — a monthly anchor of "15 Temmuz" must still read as the
// (past) 15th having rolled into next month's 15th, not stay stuck on a
// date that's already gone by. occurred_at for a recurring row is just
// "when this was added to the ledger", not something the user chose, so
// showing it as *the* date read as "wrong" (it always looked like today).
// One-off entries have no next_due_date at all, so occurred_at (now a real,
// user-editable field) is the only meaningful date there.
export function entryDisplayDate(entry: Pick<Entry, "recurrence" | "next_due_date" | "occurred_at">): string {
  if (entry.recurrence !== "none" && entry.next_due_date) {
    const next = nextOccurrenceOnOrAfter(entry.next_due_date, entry.recurrence);
    if (next) return toDateString(next);
  }
  return entry.occurred_at;
}
