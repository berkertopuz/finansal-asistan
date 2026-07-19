// Mirrors src/lib/locale.ts's fromIntlTag on the Node side — kept separate
// since Deno edge functions don't share a package with the Next.js app.
export type PromptLocale = "tr" | "en";

export function localeFromProfile(value: string | null | undefined): PromptLocale {
  return value?.toLowerCase().startsWith("en") ? "en" : "tr";
}
