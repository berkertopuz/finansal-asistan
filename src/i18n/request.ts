import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isAppLocale } from "@/lib/locale";

// "Without i18n routing" setup — no [locale] URL segment. Locale comes from
// a cookie only, so every existing route path stays stable and src/proxy.ts
// (auth cookie refresh) doesn't need to know about locales at all.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isAppLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
