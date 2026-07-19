// Locale-aware number/date formatting — Intl only, never manual string math
// (CLAUDE.md rule 4). Every formatter takes the active AppLocale ("tr"/"en")
// and maps it to the right Intl tag internally, so tr-TR's "1.234,56" and
// en-US's "1,234.56" grouping/decimal conventions are never hand-rolled.

import { toIntlTag, type AppLocale } from "@/lib/locale";

const CURRENCY_BY_LOCALE: Record<AppLocale, string> = { tr: "TRY", en: "TRY" };

export function formatCurrency(amount: number, locale: AppLocale = "tr"): string {
  return new Intl.NumberFormat(toIntlTag(locale), {
    style: "currency",
    currency: CURRENCY_BY_LOCALE[locale],
  }).format(amount);
}

// "₺650B" (tr) / "₺650K" (en) — for chart axis ticks where full currency
// formatting ("₺650.000,00") would crowd the label.
export function formatCurrencyCompact(amount: number, locale: AppLocale = "tr"): string {
  return new Intl.NumberFormat(toIntlTag(locale), {
    style: "currency",
    currency: CURRENCY_BY_LOCALE[locale],
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

// "+₺120,50" / "-₺45,00" — for P/L deltas.
export function formatSignedCurrency(amount: number, locale: AppLocale = "tr"): string {
  return new Intl.NumberFormat(toIntlTag(locale), {
    style: "currency",
    currency: CURRENCY_BY_LOCALE[locale],
    signDisplay: "exceptZero",
  }).format(amount);
}

export function formatNumber(
  value: number,
  locale: AppLocale = "tr",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(toIntlTag(locale), options).format(value);
}

// value is a fraction: 0.023 -> "+%2,3" (tr) / "+2.3%" (en)
export function formatPercent(value: number, locale: AppLocale = "tr"): string {
  return new Intl.NumberFormat(toIntlTag(locale), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
}

// value is a fraction: 0.4641 -> "%46,4" (tr) / "46.4%" (en) — no sign, for
// an absolute rate (not a delta) like the cash-flow timeline's assumed
// annual interest rate.
export function formatPercentAbs(value: number, locale: AppLocale = "tr"): string {
  return new Intl.NumberFormat(toIntlTag(locale), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(date: Date | string, locale: AppLocale = "tr"): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date));
}

// "18 Tem" (tr) / "Jul 18" (en) — compact enough for chart axis ticks.
export function formatShortDate(date: Date | string, locale: AppLocale = "tr"): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), { day: "numeric", month: "short" }).format(
    new Date(date),
  );
}

// "14:32" — for the inline price timestamp requirement (plan F.2).
export function formatTime(date: Date | string, locale: AppLocale = "tr"): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string, locale: AppLocale = "tr"): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

const RELATIVE_UNITS_TR = { justNow: "az önce", minutes: "dk önce", hours: "sa önce", days: "g önce" };
const RELATIVE_UNITS_EN = { justNow: "just now", minutes: "min ago", hours: "h ago", days: "d ago" };

// "az önce" / "3 dk önce" / "2 sa önce" / "5 g önce" (tr) — for
// StaleDataBadge and any "Veriler N dk önce güncellendi" copy.
export function formatRelative(
  from: Date | string,
  locale: AppLocale = "tr",
  now: Date = new Date(),
): string {
  const units = locale === "en" ? RELATIVE_UNITS_EN : RELATIVE_UNITS_TR;
  const diffMs = now.getTime() - new Date(from).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 1) return units.justNow;
  if (diffMinutes < 60) return `${diffMinutes} ${units.minutes}`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ${units.hours}`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} ${units.days}`;
}
