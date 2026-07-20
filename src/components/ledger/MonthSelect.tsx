"use client";

import { useLocale, useTranslations } from "next-intl";
import { toIntlTag, type AppLocale } from "@/lib/locale";

// "YYYY-MM" — sorts and compares as a plain string, no Date math needed.
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// 2 months ahead, not just current + 11 back — a recurring entry's due date
// rolls forward into whichever month it's actually next due in
// (src/lib/ledger.ts's entryDisplayDate), which is routinely next month.
// Without a next-month option here, a bill that just rolled forward would
// have nowhere to be viewed/edited from at all.
function monthOptions(locale: AppLocale): { key: string; label: string }[] {
  const formatter = new Intl.DateTimeFormat(toIntlTag(locale), { month: "long", year: "numeric" });
  const now = new Date();
  return Array.from({ length: 14 }).map((_, i) => {
    const offset = i - 2;
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: formatter.format(d) };
  });
}

export function MonthSelect({
  value,
  onChange,
  allowAll = false,
}: {
  value: string;
  onChange: (month: string) => void;
  // Tümü is a general activity feed by default (sorted by recently added,
  // not scoped to any one month) — this lets it still offer "just show me
  // one month" without forcing a month on every render. Gelirler/Giderler
  // don't pass this — they're always scoped to a specific month.
  allowAll?: boolean;
}) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger.month");
  const options = monthOptions(locale);

  // A pill row (one earlier revision of this component) took up a whole
  // extra 48px-tall horizontal strip for something that's really just a
  // single-value filter — a compact dropdown says the same thing in far
  // less space, which is what this reverts back to.
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("label")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-touch rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        {allowAll && <option value="all">{t("all")}</option>}
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
