"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const updateProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80, { message: "İsim çok uzun." })
    .optional()
    .transform((v) => (v ? v : null)),
});

export type UpdateProfileState = { error?: string; success?: boolean };

export async function updateProfile(
  _prevState: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const parsed = updateProfileSchema.safeParse({
    display_name: formData.get("display_name") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Geçersiz bilgiler." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Oturum bulunamadı, tekrar giriş yap." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.display_name })
    .eq("id", user.id);

  if (error) {
    return { error: "Kaydedilemedi, tekrar dene." };
  }

  revalidatePath("/ayarlar");
  return { success: true };
}
