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
