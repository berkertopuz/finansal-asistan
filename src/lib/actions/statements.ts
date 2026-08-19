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
// cardId = bu ekstrenin ait olduğu kart (StatementUploadSheet.tsx zaten
// hangi kart için yüklendiğini biliyor, card.id). Satıra credit_card_id
// olarak yazılıyor — bu artık "borç bu karta ait" demek, "şu tarihte
// ödenecek" değil: gerçek nakit çıkışı yalnızca kullanıcının kendi bildirdiği
// bir card_payment satırıyla (payCreditCardDebt, src/lib/actions/credit-cards.ts)
// olur, src/lib/cashflow.ts bu satırları asla doğrudan bakiyeden düşmez.
// Satır daha sonra bir aboneliğe çevrilirse de (updateEntry bu alana hiç
// dokunmuyor) credit_card_id olduğu gibi kalır, materializeDueOccurrences
// (src/lib/recurrence-materialize.ts) gelecek her ayın satırına aynı kartı
// kopyalamaya devam eder.
//
// statementDate/paymentDueDate = bu ekstrenin ayrıştırılan Hesap Kesim ve
// Son Ödeme tarihleri (StatementUploadSheet.tsx'in /api/statements/parse'tan
// aldığı header). Önce statement_imports'a bir kayıt yazılıyor (bu ekstrenin
// "hangi dönem, ne zaman, kaç işlem" izini bırakan kalıcı kaydı — Kartlar
// sayfasındaki geçmiş listesi buradan geliyor), sonra entries bu kaydın
// id'sine (statement_import_id) bağlanarak ekleniyor. entries insert'i
// başarısız olursa statement_imports satırı geri siliniyor (compensating
// delete) — src/lib/actions/positions.ts'teki "insert A, insert B, B
// başarısız olursa sessizce logla" deseninden BİLEREK farklı: oradaki B
// (entries) sadece bir maliyet kaydı, burada statement_imports'un TEK
// VAROLUŞ SEBEBİ "ne yüklendiğini doğru hatırlamak" — satırsız bir kayıt tam
// da çözmeye çalıştığımız kafa karışıklığını yaratırdı. (credit_card_id,
// statement_date) üzerindeki unique constraint aynı ekstrenin ikinci kez
// yüklenmesini Postgres seviyesinde reddeder (23505) — StatementUploadSheet.tsx
// zaten yüklemeden önce de bunu uyarıyor, bu son güvenlik ağı.
export async function importStatementEntries(
  rows: unknown[],
  cardId: string,
  statementDate: string,
  paymentDueDate?: string | null,
): Promise<ImportStatementState> {
  const t = await getTranslations("statements.errors");
  const parsed = z.array(importRowSchema).min(1).safeParse(rows);
  const parsedCardId = z.string().uuid().safeParse(cardId);
  const parsedStatementDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(statementDate);
  const parsedDueDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .safeParse(paymentDueDate);
  if (!parsed.success || !parsedCardId.success || !parsedStatementDate.success || !parsedDueDate.success) {
    return { error: t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  // Kuruş-hassasiyetli toplama: art arda onlarca ondalık tutarı JS float
  // toplama ile eklemek gerçek bir ekstrede kalıntı bırakıyor (ör.
  // 15767.300000000001) — numeric kolona öyle yazılıyordu, sadece kozmetik
  // (formatCurrency 2 ondalığa yuvarlıyor) ama gerçek bir kayıt tutarsızlığı.
  const importedTotal =
    Math.round(parsed.data.reduce((sum, row) => sum + row.tutar, 0) * 100) / 100;
  const { data: statementImport, error: importError } = await supabase
    .from("statement_imports")
    .insert({
      user_id: user.id,
      credit_card_id: parsedCardId.data,
      statement_date: parsedStatementDate.data,
      payment_due_date: parsedDueDate.data ?? null,
      imported_count: parsed.data.length,
      imported_total: importedTotal,
    })
    .select("id")
    .single();

  if (importError || !statementImport) {
    // 23505 = unique_violation — aynı kart için aynı statement_date zaten var.
    if (importError?.code === "23505") {
      return { error: t("alreadyImported") };
    }
    console.error("importStatementEntries: statement_imports insert failed", importError);
    return { error: t("saveFailed") };
  }

  const insertRows = parsed.data.map((row) => {
    // entries_installment_fields_consistent (bkz.
    // supabase/migrations/20260721130000_installments_and_categories.sql)
    // ya üçünün de null ya da üçünün de dolu olmasını şart koşuyor. LLM
    // ayrıştırması ara sıra taksit_index/taksit_sayisi çiftinden yalnızca
    // birini üretebiliyor (gerçek bir 88 satırlık QNB ekstresinde
    // gözlendi) — bu durumda hasInstallment false oluyor ama eski kod ham
    // (kısmen null) değerleri yine de installment_index/count'a yazıyordu,
    // bu da CHECK'i ihlal edip TÜM toplu insert'i (dolayısıyla ekstrenin
    // tamamını) reddediyordu. hasInstallment false ise ikisini de null'a
    // sabitlemek, tek bir bozuk satırın ekstrenin tamamını engellemesini
    // önlüyor — o satır sadece taksit rozetsiz, normal bir gider olarak
    // eklenir.
    const hasInstallment = row.taksit_index !== null && row.taksit_sayisi !== null;

    // TAKSİT SATIRLARINDA TARİH KAYMASI DÜZELTMESİ.
    //
    // Bankalar taksitli bir alışverişi her ekstrede ORİJİNAL ALIŞVERİŞ
    // TARİHİYLE tekrar yazıyor (gerçek bir QNB ekstresinde doğrulandı:
    // Mayıs-Haziran dönemine ait ekstrede 21/04 tarihli "2/3" satırları var).
    // Eskiden o tarih doğrudan occurred_at'e yazılıyordu ve Mart'ta alınan
    // bir şeyin Temmuz'da gelen 5. taksiti MART'ın harcamasına ekleniyordu —
    // yani geçmiş ayların toplamı her yeni ekstre yüklendikçe büyüyordu.
    //
    // Artık iki tarih ayrı: tutar ekstrenin dönemine (statement_date) düşüyor,
    // asıl alışveriş tarihi purchased_at'te saklanıyor. Yalnızca İLK TAKSİTTEN
    // SONRAKİ taksitlerde kaydırıyoruz — ilk taksitte alışveriş zaten bu
    // dönemde yapılmış, kaydırmak yanlış olurdu (ve DB'nin
    // purchased_at < occurred_at kuralını da ihlal ederdi).
    const isLaterInstallment = hasInstallment && row.taksit_index! > 1;
    const shiftToPeriod = isLaterInstallment && row.tarih < parsedStatementDate.data;

    return {
      user_id: user.id,
      kind: "expense" as const,
      amount: row.tutar,
      category: row.kategori,
      occurred_at: shiftToPeriod ? parsedStatementDate.data : row.tarih,
      purchased_at: shiftToPeriod ? row.tarih : null,
      credit_card_id: parsedCardId.data,
      statement_import_id: statementImport.id,
      description: row.aciklama || null,
      recurrence: "none" as const,
      // Kalan taksitler buraya YAZILMIYOR. Denendi ve geri alındı: ekstre
      // otorite, projeksiyon tahmin — tahmini deftere önceden yazınca gerçek
      // satır geldiğinde onu uzlaştırmak gerekiyor ve "atla" da "ekle" de
      // yanlış cevap veriyor (11. taksit 300, banka 12.'yi 400 yazarsa: atlarsan
      // 100 TL sessizce kaybolur, eklersen 300 fazla sayılır). Kalan taksitler
      // artık OKUMA anında türetiliyor — bkz. projectRemainingInstallments
      // (src/lib/installments.ts). Böylece uzlaştırma diye bir problem kalmıyor:
      // gerçek satır geldiğinde normal şekilde girer, sentez kendiliğinden durur.
      installment_group_id: hasInstallment ? crypto.randomUUID() : null,
      installment_index: hasInstallment ? row.taksit_index : null,
      installment_count: hasInstallment ? row.taksit_sayisi : null,
    };
  });

  const { error } = await supabase.from("entries").insert(insertRows);
  if (error) {
    console.error("importStatementEntries: entries insert failed, rolling back statement_imports", error);
    await supabase.from("statement_imports").delete().eq("id", statementImport.id);
    return { error: t("saveFailed") };
  }

  revalidatePath("/defter");
  revalidatePath("/defter/giderler/kartlar");
  revalidatePath("/");
  return { success: true, imported: insertRows.length };
}

// Bir ekstre yüklemesini tamamen geri alır — Kartlar sayfasındaki geçmiş
// listesinden ("Geri al", ayrı bir onay adımından sonra) çağrılır. RLS
// (statement_imports_delete_own) zaten sahiplik kontrolü yapıyor;
// entries.statement_import_id'nin ON DELETE CASCADE'i bu ekstreden gelen
// TÜM satırları otomatik temizliyor (bkz. migration).
export async function undoStatementImport(id: string): Promise<{ error?: string; success?: boolean }> {
  const t = await getTranslations("statements.errors");
  const supabase = await createClient();
  const { error } = await supabase.from("statement_imports").delete().eq("id", id);
  if (error) {
    return { error: t("saveFailed") };
  }
  revalidatePath("/defter");
  revalidatePath("/defter/giderler/kartlar");
  revalidatePath("/");
  return { success: true };
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
