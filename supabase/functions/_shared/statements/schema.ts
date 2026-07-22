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

export const statementResponseSchema = z.object({
  islemler: z.array(statementRowSchema),
});

export type StatementRow = z.infer<typeof statementRowSchema>;
export type StatementResponse = z.infer<typeof statementResponseSchema>;
