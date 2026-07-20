"use client";

import { useLocale, useTranslations } from "next-intl";
import { toIntlTag, type AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

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
    <div aria-label={t("label")} className="flex gap-2 overflow-x-auto py-1">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            aria-pressed={active}
            className={cn(
              "min-h-touch shrink-0 rounded-full px-4 font-mono text-xs font-medium tracking-wide whitespace-nowrap uppercase transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
