"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, fromIntlTag } from "@/lib/locale";
import { safeNextPath } from "@/lib/auth-redirect";

export type AuthFormState = { error?: string; success?: string } | undefined;

async function getSiteUrl() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

export async function signInWithPassword(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations("auth.errors");
  const credentialsSchema = z.object({
    email: z.string().trim().email({ message: t("invalidEmail") }),
    password: z.string().min(8, { message: t("passwordTooShort") }),
  });

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: t("invalidCredentials") };
  }

  // Restore the user's persisted language preference on this browser —
  // otherwise a fresh browser/device would fall back to the default locale
  // until they manually switch again.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("locale")
      .eq("id", user.id)
      .maybeSingle();
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, fromIntlTag(profile?.locale), {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  // Davet linkinden gelindiyse oraya geri dön (safeNextPath doğrular —
  // form alanı kullanıcı tarafından değiştirilebilir, açık yönlendirme
  // riskine karşı bkz. src/lib/auth-redirect.ts).
  redirect(safeNextPath(formData.get("next") as string | null));
}

export async function signUpWithPassword(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations("auth");
  const credentialsSchema = z.object({
    email: z.string().trim().email({ message: t("errors.invalidEmail") }),
    password: z.string().min(8, { message: t("errors.passwordTooShort") }),
  });

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("errors.genericInvalid") };
  }

  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  // Doğrulama linki de hedefi taşıyor: davetten gelip kayıt olan kişi
  // e-postadaki linke tıkladığında doğrudan davet sayfasına düşüyor.
  const next = safeNextPath(formData.get("next") as string | null);
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error) {
    return { error: t("errors.signupFailed") };
  }

  return { success: t("signupSuccess") };
}

// <form action={signInWithGoogle}> olarak çağrılıyor, yani ilk argüman
// formun FormData'sı — gizli "next" alanı buradan okunuyor.
export async function signInWithGoogle(formData?: FormData) {
  const supabase = await createClient();
  const siteUrl = await getSiteUrl();
  const next = safeNextPath(formData?.get("next") as string | null);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error || !data.url) {
    redirect("/giris?hata=google");
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/giris");
}
