"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildInstallmentRows } from "@/lib/installments";

// İlk sesli girişten önce ayrı ve spesifik açık rıza — recordStatementConsent
// (src/lib/actions/statements.ts) ile aynı desen, ama AYRI bir sütun: farklı
// veri türü (kullanıcının kendi ses kaydı) ve farklı alıcı (Google, OpenAI
// değil). KVKK 18.02.2026 / 2026-347 ilke kararı açık rızanın spesifik
// olmasını istiyor, ekstre onayı bunu kapsamaz.
export async function recordVoiceConsent(): Promise<{ error?: string; success?: boolean }> {
  const t = await getTranslations("ledger.voice.errors");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ voice_llm_consent_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return { error: t("transcribeFailed") };
  }
  return { success: true };
}

// Sesli girişten gelen ÇOK KALEMLİ liste. Tek kalemde arayüz zaten
// QuickEntryForm'u önceden doldurup addEntry'ye gidiyor — bu yol yalnızca
// kullanıcı tek kayıtta birden fazla harcama saydığında (asıl kullanım:
// "yüz lira sigara, elli lira ekmek, on beş lira su") ve inceleme listesinde
// onayladığında çalışıyor.
const voiceEntrySchema = z.object({
  kind: z.enum(["income", "expense", "subscription"]),
  amount: z.number().positive().max(10_000_000),
  category: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurrence: z.enum(["none", "weekly", "monthly", "yearly"]),
  installmentCount: z.number().int().min(2).max(36).nullable(),
  // "" = nakit/banka. Dolu bir id o karta borç yazar (src/lib/cashflow.ts
  // bunu bakiyeden hemen düşmez, bkz. isCardDebt).
  credit_card_id: z.string().optional().transform((v) => (v ? v : null)),
});

export type VoiceEntryInput = z.infer<typeof voiceEntrySchema>;

export async function addVoiceEntries(
  items: unknown,
): Promise<{ error?: string; success?: boolean; added?: number }> {
  const t = await getTranslations("ledger.voice.errors");
  const parsed = z.array(voiceEntrySchema).min(1).max(20).safeParse(items);
  if (!parsed.success) {
    return { error: t("saveFailed") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  // İki dal (taksitli / taksitsiz) farklı literal tipler ürettiği için
  // flatMap'in ortak tipi kendiliğinden çıkarılamıyor — satır şekli burada
  // bir kez tanımlanıyor.
  type EntryRow = {
    user_id: string;
    kind: VoiceEntryInput["kind"];
    amount: number;
    category: string;
    occurred_at: string;
    description: string | null;
    recurrence: VoiceEntryInput["recurrence"];
    next_due_date: string | null;
    installment_group_id: string | null;
    installment_index: number | null;
    installment_count: number | null;
    credit_card_id: string | null;
  };

  // Tüm kalemler tek insert'te gidiyor: kısmen yazılmış bir liste
  // ("üçünden ikisi eklendi") kullanıcının hangi kalemi tekrar söylemesi
  // gerektiğini bilemeyeceği bir durum yaratırdı.
  const rows: EntryRow[] = parsed.data.flatMap((item): EntryRow[] => {
    const isRecurring = item.recurrence !== "none";
    // Gelir hiçbir zaman kart taşıyamaz (DB CHECK
    // entries_credit_card_id_kind_check) — form tarafındaki aynı sunucu
    // taraflı emniyet.
    const creditCardId = item.kind === "income" ? null : item.credit_card_id;

    // Taksit yalnızca tekrarsız gider için anlamlı — addEntry'deki aynı kural.
    if (item.installmentCount && item.kind === "expense" && !isRecurring) {
      const groupId = crypto.randomUUID();
      return buildInstallmentRows(item.amount, item.installmentCount, item.occurred_at).map((row) => ({
        user_id: user.id,
        kind: "expense",
        amount: row.amount,
        category: item.category,
        occurred_at: row.occurred_at,
        description: item.description || null,
        recurrence: "none",
        next_due_date: null,
        installment_group_id: groupId,
        installment_index: row.index,
        installment_count: row.count,
        credit_card_id: creditCardId,
      }));
    }

    return [
      {
        user_id: user.id,
        kind: item.kind,
        amount: item.amount,
        category: item.category,
        occurred_at: item.occurred_at,
        description: item.description || null,
        recurrence: item.recurrence,
        // Tekrarlayan bir satırın ilk vadesi, duyulan tarihin kendisi.
        next_due_date: isRecurring ? item.occurred_at : null,
        installment_group_id: null,
        installment_index: null,
        installment_count: null,
        credit_card_id: creditCardId,
      },
    ];
  });

  const { error } = await supabase.from("entries").insert(rows);
  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true, added: rows.length };
}
