import { z } from "zod";
import { ENTRY_CATEGORIES } from "@/lib/ledger";

// parse-statement edge function'ının döndürdüğü satırların Next.js
// tarafındaki ikinci doğrulaması (supabase/functions/_shared/statements/schema.ts
// ile aynı şekil — iki runtime, elle senkron tutulan iki dosya, openai-client.ts
// desenindeki gibi). Edge function zaten zod response_format ile şekli
// garanti ediyor; burası içerik düzeyinde güvenilmez satırları eler (recommendations
// akışındaki "atıf eşleşmiyorsa satır at" pattern'inin eşdeğeri). Bu dosya
// Next.js/Node tarafında çalıştığı için "kategori" için Deno tarafındaki
// gibi ayrı bir kopya yerine doğrudan ENTRY_CATEGORIES'i (src/lib/ledger.ts)
// kullanıyor — tek kaynak, aynı taksonomi.
// LLM'e "DD/MM/YYYY -> YYYY-MM-DD çevir" talimatı verilse de (bkz.
// supabase/functions/_shared/statements/prompts.ts kural 6) bu bir talimata
// uyum meselesi, garanti değil — gerçek bir QNB ekstresinde model bazı
// satırlarda tarihi DD/MM/YYYY olarak bıraktı, ISO regex'i HİÇ eşleşmedi ve
// filterValidStatementRows tüm satırları sessizce eledi (kullanıcıya "bu
// ekstrede işlem bulunamadı" olarak göründü). Deterministik bir düzeltme —
// zaten ISO ise dokunma, DD/MM/YYYY ise çevir — LLM'in bu tek, mekanik
// dönüşümde tutarlı olmasına güvenmekten daha güvenilir.
function normalizeDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const ddmmyyyy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return ddmmyyyy ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}` : value;
}

export const statementRowSchema = z.object({
  tarih: z.preprocess(normalizeDate, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  aciklama: z.string(),
  tutar: z.number().positive(),
  tur: z.enum(["harcama", "odeme", "ucret"]),
  // .catch("diğer") — kategori tahmini yanlış/beklenmedik bir değerse tüm
  // satırı (doğru tarih/tutarıyla) atmak yerine "diğer"e düşür; tur/tutar/tarih
  // gibi asıl finansal doğruluğu etkileyen alanlar hâlâ katı doğrulanıyor.
  kategori: z.enum(ENTRY_CATEGORIES).catch("diğer"),
  taksit_index: z.number().int().min(1).nullable(),
  taksit_sayisi: z.number().int().min(2).nullable(),
});

export type StatementRow = z.infer<typeof statementRowSchema>;

// Şekli doğru ama içerik olarak güvenilmez satırları (negatif/sıfır tutar,
// taksit_index > taksit_sayisi gibi tutarsızlıklar) sessizce eler —
// kullanıcıya hiç gösterilmez, tıpkı recommendations'ın atıf-eşleşmeyen
// satırı atması gibi.
export function filterValidStatementRows(raw: unknown[]): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const item of raw) {
    const parsed = statementRowSchema.safeParse(item);
    if (!parsed.success) continue;
    const row = parsed.data;
    if (row.taksit_index !== null && row.taksit_sayisi !== null && row.taksit_index > row.taksit_sayisi) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}
