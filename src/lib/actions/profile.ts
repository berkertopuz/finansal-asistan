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

export type UpdateAssumedRateState = { error?: string; success?: boolean };

// Drives the cash-flow timeline's float-gain estimate — seeded from a live
// TCMB EVDS rate on first render (src/lib/providers/evds.ts) but editable
// from then on, since the user may want to model their own bank's actual
// offer rather than the sector average.
export async function updateAssumedRate(
  _prevState: UpdateAssumedRateState,
  formData: FormData,
): Promise<UpdateAssumedRateState> {
  const t = await getTranslations("cashflow.errors");
  const schema = z.object({
    assumed_annual_rate: z.coerce.number().min(0).max(200, { message: t("rateOutOfRange") }),
  });

  const parsed = schema.safeParse({
    assumed_annual_rate: formData.get("assumed_annual_rate"),
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
    .update({ assumed_annual_rate: parsed.data.assumed_annual_rate })
    .eq("id", user.id);

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  return { success: true };
}
