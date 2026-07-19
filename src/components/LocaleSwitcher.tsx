"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { setLocale } from "@/lib/actions/locale";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/lib/locale";

const OPTIONS: { value: AppLocale; label: string }[] = [
  { value: "tr", label: "TR" },
  { value: "en", label: "EN" },
];

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as AppLocale;
  const [pending, startTransition] = useTransition();

  function switchTo(next: AppLocale) {
    if (next === locale || pending) return;
    startTransition(() => {
      void setLocale(next);
    });
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5 text-xs font-medium",
        className,
      )}
      role="group"
      aria-label="Dil / Language"
    >
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => switchTo(value)}
          disabled={pending}
          aria-pressed={locale === value}
          className={cn(
            "min-h-touch min-w-touch rounded-md px-2.5 py-1 transition-colors",
            locale === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
