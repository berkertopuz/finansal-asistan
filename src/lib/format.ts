// tr-TR number/date formatting — Intl only, never manual string math (CLAUDE.md rule 4).
// Turkish locale uses "." as the group separator and "," as the decimal separator,
// which is exactly what trips up hand-rolled string formatting (₺1.234,56).

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
});

const signedCurrencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  signDisplay: "exceptZero",
});

const numberFormatter = new Intl.NumberFormat("tr-TR");

// Expects a fraction (0.023), not a whole percentage (2.3) — matches the
// Intl "percent" style convention and formats as "+%2,3" / "%2,3".
const percentFormatter = new Intl.NumberFormat("tr-TR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatCurrencyTRY(amount: number): string {
  return currencyFormatter.format(amount);
}

// "+₺120,50" / "-₺45,00" — for P/L deltas.
export function formatSignedCurrencyTRY(amount: number): string {
  return signedCurrencyFormatter.format(amount);
}

export function formatNumberTR(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return options
    ? new Intl.NumberFormat("tr-TR", options).format(value)
    : numberFormatter.format(value);
}

// value is a fraction: 0.023 -> "+%2,3"
export function formatPercentTR(value: number): string {
  return percentFormatter.format(value);
}

export function formatDateTR(date: Date | string): string {
  return dateFormatter.format(new Date(date));
}

// "14:32" — for the inline price timestamp requirement (plan F.2).
export function formatTimeTR(date: Date | string): string {
  return timeFormatter.format(new Date(date));
}

export function formatDateTimeTR(date: Date | string): string {
  return dateTimeFormatter.format(new Date(date));
}

// "az önce" / "3 dk önce" / "2 sa önce" / "5 g önce" — for StaleDataBadge
// and any "Veriler N dk önce güncellendi" copy.
export function formatRelativeTR(from: Date | string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(from).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 1) return "az önce";
  if (diffMinutes < 60) return `${diffMinutes} dk önce`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} sa önce`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} g önce`;
}
