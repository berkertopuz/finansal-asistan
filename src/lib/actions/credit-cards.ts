"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type CreditCardState = { error?: string; success?: boolean };

async function buildCardSchema() {
  const t = await getTranslations("creditCards.errors");
  return z.object({
    name: z.string().trim().min(1, { message: t("nameRequired") }).max(50, { message: t("nameTooLong") }),
    statement_day: z.coerce.number().int().min(1).max(31, { message: t("dayInvalid") }),
    payment_day: z.coerce.number().int().min(1).max(31, { message: t("dayInvalid") }),
  });
}

export async function addCreditCard(
  _prevState: CreditCardState,
  formData: FormData,
): Promise<CreditCardState> {
  const t = await getTranslations("creditCards.errors");
  const schema = await buildCardSchema();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    statement_day: formData.get("statement_day"),
    payment_day: formData.get("payment_day"),
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

  const { error } = await supabase.from("credit_cards").insert({
    user_id: user.id,
    name: parsed.data.name,
    statement_day: parsed.data.statement_day,
    payment_day: parsed.data.payment_day,
  });

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter/giderler/kartlar");
  revalidatePath("/defter/giderler");
  return { success: true };
}

export async function updateCreditCard(
  id: string,
  updates: { statement_day?: number; payment_day?: number; reminders_enabled?: boolean },
): Promise<CreditCardState> {
  const t = await getTranslations("creditCards.errors");
  const supabase = await createClient();
  // RLS (credit_cards_update_own) zaten çağıranın kendi kartına scope ediyor.
  const { error } = await supabase.from("credit_cards").update(updates).eq("id", id);
  if (error) {
    return { error: t("saveFailed") };
  }
  revalidatePath("/defter/giderler/kartlar");
  return { success: true };
}

export async function deleteCreditCard(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("credit_cards").delete().eq("id", id);
  revalidatePath("/defter/giderler/kartlar");
  revalidatePath("/defter/giderler");
}
