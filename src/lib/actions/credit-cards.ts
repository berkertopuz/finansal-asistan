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

const payDebtSchema = z.object({
  cardId: z.string().uuid(),
  // Aynı üst sınır entries.ts'teki amount ile aynı — DB CHECK (amount > 0)
  // asıl güvenlik ağı, bu sadece daha erken/dostane bir hata.
  amount: z.coerce.number().positive().max(10_000_000),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Kullanıcının bir karta yaptığı gerçek ödemeyi kaydeder — tam ya da kısmi,
// asgari ya da toplam borç, fark etmiyor: bu formun kendisi ne kadar
// ödendiğini elle sorduğu için (src/components/statements/CreditCardsManager.tsx'teki
// "Borç öde" dialoğu, StatementUploadSheet.tsx'teki ekstre sonrası
// isteğe bağlı adım) miktar tamamen kullanıcının beyanı. entries'e
// kind='card_payment' olarak yazılır — bir gider değil, nakitten kart
// borcuna bir transfer (src/lib/cashflow.ts bunu doğrudan nakitten düşer,
// creditCardDebtBalance ise aynı satırı o kartın borcundan düşer).
// credit_cards'ın kendi RLS'i (yalnızca sahibi seçebilir) zaten kartı
// başkasına ait bir id ile sorgulamayı sessizce boş döndürür — burada ayrıca
// var olduğunu doğrulayıp yoksa net bir hata mesajı veriyoruz.
export async function payCreditCardDebt(
  cardId: string,
  amount: number,
  occurredAt: string,
): Promise<CreditCardState> {
  const t = await getTranslations("creditCards.errors");
  const parsed = payDebtSchema.safeParse({ cardId, amount, occurred_at: occurredAt });
  if (!parsed.success) {
    return { error: t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const { data: card } = await supabase
    .from("credit_cards")
    .select("id")
    .eq("id", parsed.data.cardId)
    .maybeSingle();
  if (!card) {
    return { error: t("cardNotFound") };
  }

  const { error } = await supabase.from("entries").insert({
    user_id: user.id,
    kind: "card_payment" as const,
    amount: parsed.data.amount,
    occurred_at: parsed.data.occurred_at,
    credit_card_id: parsed.data.cardId,
    recurrence: "none" as const,
  });

  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter/giderler/kartlar");
  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true };
}
