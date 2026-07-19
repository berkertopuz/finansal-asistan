"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type UpdateProfileState = { error?: string; success?: boolean };

export async function updateProfile(
  _prevState: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const t = await getTranslations("settings.errors");
  const updateProfileSchema = z.object({
    display_name: z
      .string()
      .trim()
      .max(80, { message: t("nameTooLong") })
      .optional()
      .transform((v) => (v ? v : null)),
  });

  const parsed = updateProfileSchema.safeParse({
    display_name: formData.get("display_name") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.display_name })
    .eq("id", user.id);

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/ayarlar");
  return { success: true };
}
