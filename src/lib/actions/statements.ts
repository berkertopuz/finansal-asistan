"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ENTRY_CATEGORIES } from "@/lib/ledger";

export type ImportStatementState = { error?: string; success?: boolean; imported?: number };

const importRowSchema = z.object({
  tarih: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aciklama: z.string().trim().max(200),
  tutar: z.number().positive().max(10_000_000),
  kategori: z.enum(ENTRY_CATEGORIES).catch("diğer"),
  taksit_index: z.number().int().min(1).nullable(),
  taksit_sayisi: z.number().int().min(2).nullable(),
});

const paymentDueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

// Kullanıcının inceleme ekranında işaretleyip onayladığı satırlar — hangi
// satırların "harcama" mı "ödeme/ücret" mi olduğu, mükerrer olup olmadığı
// zaten StatementUploadSheet.tsx'te (client) elenmiş; buraya gelen her satır
// bir gider olarak eklenecek demektir. Taksitli bir ekstre satırı, taksit.ts
// (src/lib/installments.ts) ile üretilen seriden farklı — burada N satırlık
// bir seri baştan oluşturulmuyor, sadece bu ayki payı kaydediliyor; kendi
// installment_group_id'si var ama tek üyeli (CHECK constraint bunu zaten
// destekliyor, bkz. supabase/migrations/20260721130000_installments_and_categories.sql).
//
// category = parse-statement'ın satır başına önerdiği semantik kategori
// (yemek/eğlence/market/ulaşım/abonelik/fatura/diğer — src/lib/ledger.ts'teki
// ENTRY_CATEGORIES'ten, kart adı DEĞİL). Kullanıcı ileride kategoriye göre
// harcama grafikleri planladığı için sabit bir taksonomi kullanmak
// kasıtlı — serbest metin kart adı bu amaca uymazdı.
//
// paymentDueDate = bu ekstrenin ayrıştırılan son ödeme tarihi
// (StatementUploadSheet.tsx'in /api/statements/parse'tan aldığı
// header.paymentDueDate) — her satıra cash_out_at olarak yazılıyor. Kart
// harcaması, ekstre ödenene kadar bir borç: para hesaptan satın alma
// gününde değil, bu tarihte çıkıyor. Ayrıştırma bir sebeple bu tarihi
// bulamadıysa (null) cash_out_at da null kalır — src/lib/cashflow.ts bu
// durumda occurred_at'e düşer, yani eskisi gibi davranır (uydurma tarih
// yazmaktansa daha güvenli).
export async function importStatementEntries(
  rows: unknown[],
  paymentDueDate?: string | null,
): Promise<ImportStatementState> {
  const t = await getTranslations("statements.errors");
  const parsed = z.array(importRowSchema).min(1).safeParse(rows);
  const parsedDueDate = paymentDueDateSchema.safeParse(paymentDueDate);
  if (!parsed.success || !parsedDueDate.success) {
    return { error: t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const cashOutAt = parsedDueDate.data ?? null;
  const insertRows = parsed.data.map((row) => {
    const hasInstallment = row.taksit_index !== null && row.taksit_sayisi !== null;
    return {
      user_id: user.id,
      kind: "expense" as const,
      amount: row.tutar,
      category: row.kategori,
      occurred_at: row.tarih,
      cash_out_at: cashOutAt,
      description: row.aciklama || null,
      recurrence: "none" as const,
      installment_group_id: hasInstallment ? crypto.randomUUID() : null,
      installment_index: row.taksit_index,
      installment_count: row.taksit_sayisi,
    };
  });

  const { error } = await supabase.from("entries").insert(insertRows);
  if (error) {
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  revalidatePath("/");
  return { success: true, imported: insertRows.length };
}

// İlk ekstre yüklemesinden önce ayrı ve spesifik açık rıza — bkz. plan
// dosyasındaki KVKK notu (18.02.2026 tarihli 2026/347 sayılı ilke kararı).
export async function recordStatementConsent(): Promise<{ error?: string; success?: boolean }> {
  const t = await getTranslations("statements.errors");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ statement_llm_consent_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return { error: t("saveFailed") };
  }
  return { success: true };
}
