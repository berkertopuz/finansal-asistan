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

export const ENTRY_KINDS: { value: EntryKind; label: string }[] = [
  { value: "expense", label: "Gider" },
  { value: "income", label: "Gelir" },
  { value: "subscription", label: "Abonelik" },
];

export const ENTRY_RECURRENCES: { value: EntryRecurrence; label: string }[] = [
  { value: "none", label: "Tek seferlik" },
  { value: "weekly", label: "Haftalık" },
  { value: "monthly", label: "Aylık" },
  { value: "yearly", label: "Yıllık" },
];

// Preset category chips (docs/phase1-plan.md A.1 — entries.category).
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
