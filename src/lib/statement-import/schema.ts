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

export type StatementHeader = {
  statementDate: string | null; // YYYY-MM-DD
  paymentDueDate: string | null; // YYYY-MM-DD
};

// Bu iki tarih artık banka başına regex ile değil, modelin ekstre özeti
// adaylarından seçmesiyle geliyor (bkz. extract.ts tasarım notu) — yani
// "deterministik olarak doğru" olmaktan "doğrulanması gereken" hale geldiler.
// statement_imports'un dönem anahtarı bu tarih olduğu için (unique(card,
// statement_date)) uydurma bir tarih sessizce yanlış bir döneme yazardı;
// makul olmayan her değer null'a düşürülür ve kullanıcı içe aktarma
// ekranında tarihin boş olduğunu görür.
const PLAUSIBLE_YEAR_RANGE = { min: 2000, max: 2100 };

function toPlausibleIsoDate(value: unknown): string | null {
  const normalized = normalizeDate(value);
  if (typeof normalized !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (year < PLAUSIBLE_YEAR_RANGE.min || year > PLAUSIBLE_YEAR_RANGE.max) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Takvimde gerçekten var mı (31 Şubat gibi bir tarihi ele)
  const date = new Date(`${normalized}T00:00:00Z`);
  return date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? normalized : null;
}

export function parseStatementHeader(raw: unknown): StatementHeader {
  const source = (raw ?? {}) as { hesap_kesim_tarihi?: unknown; son_odeme_tarihi?: unknown };
  return {
    statementDate: toPlausibleIsoDate(source.hesap_kesim_tarihi),
    paymentDueDate: toPlausibleIsoDate(source.son_odeme_tarihi),
  };
}

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
