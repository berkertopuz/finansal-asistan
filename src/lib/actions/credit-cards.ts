"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CATEGORY, toDateString } from "@/lib/ledger";
import type { CreditCard } from "@/lib/credit-cards-data";

// `card`: yeni oluşturulan satır. Ekstre yükleme akışı (PDF önce, kart
// sonra) kartı oluşturur oluşturmaz onun id'siyle inceleme adımına geçmek
// zorunda — kullanıcıyı "kartı ekledim, şimdi listeden yine ben mi seçeyim"
// noktasına düşürmemek için. Mevcut useActionState çağrıları bu alanı
// okumuyor, eklenmesi onları etkilemiyor.
export type CreditCardState = { error?: string; success?: boolean; card?: CreditCard };

async function buildCardSchema() {
  const t = await getTranslations("creditCards.errors");
  return z.object({
    name: z.string().trim().min(1, { message: t("nameRequired") }).max(50, { message: t("nameTooLong") }),
    statement_day: z.coerce.number().int().min(1).max(31, { message: t("dayInvalid") }),
    payment_day: z.coerce.number().int().min(1).max(31, { message: t("dayInvalid") }),
    // İsteğe bağlı — boş string'i (formun dokunulmamış hali) undefined'a
    // düşürüyoruz, aksi halde z.coerce.number() onu 0'a çevirip alanı hep
    // "dolu" gibi geçerdi (0 girmekle boş bırakmak arasında fark kalmazdı,
    // aşağıdaki "> 0 ise satır ekle" kontrolü için önemli değil ama niyeti
    // net tutmak için ayırıyoruz).
    starting_debt: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().min(0).max(10_000_000, { message: t("genericInvalid") }).optional(),
    ),
  });
}

export async function addCreditCard(
  _prevState: CreditCardState,
  formData: FormData,
): Promise<CreditCardState> {
  const t = await getTranslations("creditCards.errors");
  const tCommon = await getTranslations("creditCards");
  const schema = await buildCardSchema();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    statement_day: formData.get("statement_day"),
    payment_day: formData.get("payment_day"),
    starting_debt: formData.get("starting_debt"),
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

  const { data, error } = await supabase
    .from("credit_cards")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      statement_day: parsed.data.statement_day,
      payment_day: parsed.data.payment_day,
    })
    .select("id, name, statement_day, payment_day, reminders_enabled")
    .single();

  if (error) {
    return { error: t("saveFailed") };
  }

  // Kart uygulamaya girmeden ÖNCE zaten bir borcu varsa, creditCardDebtBalance
  // (src/lib/cashflow.ts) bunu bilemez — o yalnızca entries'teki satırları
  // toplar, sıfırdan başladığını varsayar. Kullanıcı bir başlangıç bakiyesi
  // girdiyse, bunu normal bir "harcama" gibi (kart borcunu artıran) tek
  // seferlik bir satır olarak ekliyoruz — yeni bir kolon/formül gerekmiyor,
  // mevcut hesaplama bu satırı diğer her satır gibi doğru sayıyor. Ekstre/
  // taksit'e bağlı değil, tarih kartın oluşturulduğu gün.
  if (parsed.data.starting_debt && parsed.data.starting_debt > 0) {
    const { error: startingDebtError } = await supabase.from("entries").insert({
      user_id: user.id,
      kind: "expense" as const,
      amount: parsed.data.starting_debt,
      category: DEFAULT_CATEGORY,
      occurred_at: toDateString(new Date()),
      credit_card_id: data.id,
      description: tCommon("startingDebtDescription"),
      recurrence: "none" as const,
    });
    if (startingDebtError) {
      console.error("addCreditCard: starting debt entry insert failed", startingDebtError);
    }
  }

  revalidatePath("/defter/giderler/kartlar");
  revalidatePath("/defter/giderler");
  return { success: true, card: data as CreditCard };
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
