// Two locale representations coexist on purpose:
// - AppLocale ("tr"/"en") drives next-intl's message catalog lookup.
// - profiles.locale stores a full BCP-47 tag ("tr-TR"/"en-US") because
//   Intl.NumberFormat/DateTimeFormat need the region for correct currency
//   symbol placement and grouping (see src/lib/format.ts).
export type AppLocale = "tr" | "en";

export const DEFAULT_LOCALE: AppLocale = "tr";
export const SUPPORTED_LOCALES: AppLocale[] = ["tr", "en"];

export const LOCALE_COOKIE = "NEXT_LOCALE";

const INTL_TAGS: Record<AppLocale, string> = {
  tr: "tr-TR",
  en: "en-US",
};

export function toIntlTag(locale: AppLocale): string {
  return INTL_TAGS[locale];
}

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "tr" || value === "en";
}

// profiles.locale ("tr-TR"/"en-US") -> AppLocale ("tr"/"en"), defaulting to
// tr for anything unrecognized (including the pre-i18n default value).
export function fromIntlTag(value: string | null | undefined): AppLocale {
  return value?.toLowerCase().startsWith("en") ? "en" : DEFAULT_LOCALE;
}
