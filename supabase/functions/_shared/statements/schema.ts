import { z } from "npm:zod@^4";

// src/lib/ledger.ts'teki ENTRY_CATEGORIES ile birebir aynı liste — kasıtlı
// olarak elle senkron (iki runtime, tek paket yok, openai-client.ts'teki
// desen). Kullanıcı ileride kategoriye göre harcama grafikleri yapmayı
// planlıyor — bu yüzden model SERBEST bir kategori uydurmuyor, bu SABİT
// listeden seçiyor: aksi halde "Yemek"/"Yeme-İçme"/"Restoran" gibi farklı
// yazımlar veriyi parçalayıp grafikleri anlamsızlaştırırdı.
export const STATEMENT_CATEGORIES = [
  "maaş",
  "serbest",
  "kira",
  "fatura",
  "abonelik",
  "market",
  "yemek",
  "eğlence",
  "ulaşım",
  "diğer",
] as const;

// Next.js tarafında da aynı şekli bekleyen bir doğrulama var
// (src/lib/statement-import/schema.ts) — iki runtime, tek şema yerine elle
// senkron tutulan iki dosya (openai-client.ts'teki aynı desen).
export const statementRowSchema = z.object({
  tarih: z.string(), // YYYY-MM-DD
  aciklama: z.string(),
  tutar: z.number(),
  // harcama: normal satın alma. odeme: kartın kendisine yapılan ödeme
  // (gider değil). ucret: faiz/KKDF/BSMV gibi banka ücreti.
  tur: z.enum(["harcama", "odeme", "ucret"]),
  kategori: z.enum(STATEMENT_CATEGORIES),
  taksit_index: z.number().nullable(),
  taksit_sayisi: z.number().nullable(),
});

// Ekstre başlığı (kesim tarihi / son ödeme tarihi) artık Next.js tarafında
// banka başına regex ile DEĞİL, modelin markdown'daki "Ekstre özeti"
// bölümündeki aday etiketlerden seçmesiyle bulunuyor — bu, yeni bir banka
// için tarih etiketi eklemek zorunluluğunu tamamen kaldıran değişikliğin
// LLM tarafındaki ucu (bkz. src/lib/statement-import/extract.ts tasarım notu).
// Bulunamayan alan null döner; uydurma tarih üretmek yasak (prompt kural 2).
export const statementHeaderSchema = z.object({
  hesap_kesim_tarihi: z.string().nullable(), // YYYY-MM-DD
  son_odeme_tarihi: z.string().nullable(), // YYYY-MM-DD
});

export const statementResponseSchema = z.object({
  ekstre: statementHeaderSchema,
  islemler: z.array(statementRowSchema),
});

export type StatementRow = z.infer<typeof statementRowSchema>;
export type StatementHeader = z.infer<typeof statementHeaderSchema>;
export type StatementResponse = z.infer<typeof statementResponseSchema>;
