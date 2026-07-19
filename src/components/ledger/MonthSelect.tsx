"use client";

import { useLocale, useTranslations } from "next-intl";
import { toIntlTag, type AppLocale } from "@/lib/locale";

// "YYYY-MM" — sorts and compares as a plain string, no Date math needed.
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions(locale: AppLocale): { key: string; label: string }[] {
  const formatter = new Intl.DateTimeFormat(toIntlTag(locale), { month: "long", year: "numeric" });
  const now = new Date();
  return Array.from({ length: 12 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: formatter.format(d) };
  });
}

export function MonthSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (month: string) => void;
}) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("ledger.month");
  const options = monthOptions(locale);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("label")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-touch rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
