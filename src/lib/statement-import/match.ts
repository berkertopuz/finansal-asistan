import type { Entry } from "@/lib/ledger";
import type { StatementRow } from "@/lib/statement-import/schema";

// Ekstre satırı <-> elle girilmiş kayıt EŞLEŞTİRMESİ.
//
// Bileşenden ayrı bir modülde, çünkü burası ekstre akışının en incelikli
// ve en sessiz kırılan parçası: yanlış eşleşme gerçek bir harcamayı
// deftere hiç sokmuyor ve kullanıcı bunu aylar sonra fark ediyor. Saf bir
// fonksiyon olduğu için testi de ucuz (tests/statement-import/match.test.mjs).

export type ReviewMatch = {
  possibleDuplicate: boolean;
  duplicateOf: { occurred_at: string; amount: number } | null;
  replaces: { id: string; label: string } | null;
};

const FX_SPREAD_TOLERANCE = 0.12;
const FX_DATE_WINDOW_DAYS = 3;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a + "T00:00:00") - Date.parse(b + "T00:00:00")) / 86_400_000;
}

// Ekstrenin "odeme" satırı (bankaya yapılan gerçek ödeme) bu karta zaten
// kayıtlı bir card_payment'la mı örtüşüyor? Tarih penceresi bankanın işlem
// tarihiyle kullanıcının "Tam ödedim" akışında seçtiği tarih arasındaki
// olağan kaymayı (birkaç iş günü) kapsıyor için gevşek; tutarda ise
// tolerans yok — bir ödeme miktarı kur/komisyon gibi tahmine dayalı
// değil, tam eşleşmesi gerekiyor.
const PAYMENT_DATE_WINDOW_DAYS = 5;

export function isPaymentAlreadyRecorded(row: StatementRow, existing: Entry[], creditCardId: string): boolean {
  return existing.some(
    (e) =>
      e.kind === "card_payment" &&
      e.credit_card_id === creditCardId &&
      Math.abs(e.amount - row.tutar) < 0.01 &&
      daysBetween(e.occurred_at, row.tarih) <= PAYMENT_DATE_WINDOW_DAYS,
  );
}

// TAKSİT DALININ GEREKÇESİ (aşağıdaki toReviewRows, 1. adım).
// TAKSİTLİ satırlarda mükerrer tespiti TARİHE BAKMAZ, seri kimliğine bakar.
//
// Sebep: aynı gerçek dünya olayı iki farklı şekilde modelleniyor. Kullanıcı
// 5.000 TL'lik 6 taksitli bir alışverişi elle girdiğinde src/lib/installments.ts
// tek bir gruba 6 satır yazıyor ve tarihleri ARDIŞIK aylara koyuyor
// (anchor + i ay). Ekstredeki taksit satırı ise her ay ORİJİNAL ALIŞVERİŞ
// TARİHİNİ taşıyor (bkz. supabase/functions/_shared/statements/prompts.ts
// kural 7 — gerçek bir QNB ekstresinde Mayıs-Haziran dönemine ait ekstrede
// 21/04 tarihli taksit satırları görüldü) ve tek üyeli kendi grubuna yazılıyor
// (src/lib/actions/statements.ts).
//
// Eski kural (aynı tarih + aynı tutar) bu yüzden serinin yalnızca 1. taksitiyle
// tesadüfen eşleşiyordu ve iki durumda kırılıyordu:
//   - Son taksit kuruş kalanını yutuyor: 5.000/6 -> 833,33 ama son 833,35.
//     Fark 0,02, tolerans "< 0,01" olduğu için eşleşme yok -> MÜKERRER.
//     (1.000/3 gibi bazı vakalar kayan nokta şansıyla geçiyordu — yani tutar
//     toleransı zaten güvenilmezdi.)
//   - Kullanıcının girdiği alışveriş tarihi bankanın işlem tarihinden farklıysa
//     hiçbir taksit eşleşmiyordu.
//
// Yeni kural: aynı kart + aynı taksit sayısı + aynı taksit sırası. Tutar hâlâ
// kontrol ediliyor ama toleransı kuruş dağıtımından TÜRETİLİYOR: dağıtım en
// fazla (count-1) kuruş sapma üretebildiği için tolerans count kuruş. Böylece
// yuvarlama farkı eşleşmeyi bozmuyor, ama gerçekten farklı tutarlı bir
// alışveriş de yanlışlıkla mükerrer sayılmıyor.


// Elle girilen kayıt ile ekstre satırı arasındaki TARİH PENCERESİ.
//
// Neden gerekli: ekstredeki tarih "bankanın muhasebeleştirdiği gün",
// kullanıcının kaydındaki tarih ise "uygulamaya girdiği gün" (form alanı
// bugünle açılıyor, çoğu kişi dokunmuyor). Pazartesi yapılan bir harcama
// Salı girilir, banka onu Cuma'ya yazabilir. Eski kural TAM EŞİTLİK arıyordu
// ve bir gün kayma mükerreri tamamen kaçırıyordu — aynı harcama sessizce iki
// kez sayılıyordu. Dövizli yol bu pencereyi zaten kullanıyordu
// (FX_DATE_WINDOW_DAYS); TL tarafında olmaması bir tutarsızlıktı.
const DUPLICATE_DATE_WINDOW_DAYS = 3;

// Tutar toleransı DAR: kur makası yok, TL tutarı birebir olmalı. Pencereyi
// tarihte gevşetip tutarda da gevşetmek, farklı iki harcamayı eşleştirmeye
// başlardı.
const DUPLICATE_AMOUNT_TOLERANCE = 0.01;

type MatchCandidate = { entry: Entry; distance: number };

// Bir ekstre satırına uyan, HENÜZ TÜKETİLMEMİŞ kayıtlar arasından tarihi en
// yakın olanı seçer. En yakını tercih etmek bedava bir iyileşme: tam tarih
// eşleşmesi varsa o kazanıyor, pencere yalnızca gerçekten kayma olduğunda
// devreye giriyor.
function closestUnconsumed(
  existing: Entry[],
  consumed: Set<string>,
  predicate: (entry: Entry) => boolean,
  rowDate: string,
): Entry | null {
  let best: MatchCandidate | null = null;
  for (const entry of existing) {
    if (consumed.has(entry.id)) continue;
    if (!predicate(entry)) continue;
    const distance = daysBetween(entry.occurred_at, rowDate);
    if (!best || distance < best.distance) best = { entry, distance };
  }
  return best?.entry ?? null;
}

// Ekstre satırlarını inceleme satırlarına çevirir.
//
// KRİTİK OLAN: eşleşen kayıt TÜKETİLİYOR — her elle girilmiş kayıt en fazla
// BİR ekstre satırına karşılık gelebilir. Eski kod `existing.some(...)` ile
// çalışıyordu, yani aynı kayıt sınırsız sayıda satırla eşleşebiliyordu. Tam
// tarih eşitliği bunu büyük ölçüde gizliyordu ama pencere genişleyince
// gerçek bir veri kaybına dönüşüyor: her gün 125 TL sigara alan ama 30 günün
// yalnızca 10'unu elle girmiş bir kullanıcıda, 30 ekstre satırının çoğu aynı
// 10 kayıtla eşleşip "mükerrer" damgası yerdi ve gerçekten harcanan 20 gün
// deftere HİÇ girmezdi. Tüketimle: 30 satır / 10 kayıt -> tam 10 eşleşme,
// kalan 20 satır yeni harcama olarak gelir.
//
// Tüketim havuzu ORTAK: taksit, dövizli ve sıradan TL eşleşmeleri aynı
// `consumed` kümesini paylaşıyor, yani bir kayıt bir kez kullanılınca hiçbir
// eşleşme türü onu tekrar alamıyor.
//
// Satırlar TARİHE GÖRE işleniyor (çıktı sırası korunuyor): eşleştirme
// deterministik olsun diye — aynı ekstre iki kez yüklenince aynı sonucu
// vermeli.
export function matchStatementRows(rows: StatementRow[], existing: Entry[], creditCardId: string): ReviewMatch[] {
  const consumed = new Set<string>();
  const results = new Map<number, ReviewMatch>();

  const order = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.tarih.localeCompare(b.row.tarih));

  for (const { row, index } of order) {
    // kind === "expense" only would miss a row that started as an import
    // (kind="expense") and was later converted into a real subscription
    // rule (kind="subscription" — src/components/ledger/QuickEntryForm.tsx's
    // "kart harcamalarından abonelik" edit flow) or was already tracked as
    // one: re-uploading the same statement would silently offer it again as
    // a "new" charge instead of flagging it.
    const isSpendKind = (e: Entry) => e.kind === "expense" || e.kind === "subscription";
    // Başka bir karta AÇIKÇA yazılmış bir kayıt bu satır olamaz. null
    // (nakit/belirtilmemiş) kabul ediliyor: kullanıcı kaydı girerken kartı
    // seçmemiş olabilir. findForeignMatch'in kuralıyla aynı.
    const cardCompatible = (e: Entry) =>
      e.credit_card_id === creditCardId || e.credit_card_id === null;

    // 1) Taksit — tarihe DEĞİL seri kimliğine bakıyor (aşağıdaki
    //    yukarıdaki "TAKSİT DALININ GEREKÇESİ" notu), o yüzden önce o deneniyor.
    let installmentMatch: Entry | null = null;
    if (row.taksit_index !== null && row.taksit_sayisi !== null) {
      const tolerance = row.taksit_sayisi * 0.01;
      installmentMatch = closestUnconsumed(
        existing,
        consumed,
        (e) =>
          isSpendKind(e) &&
          e.credit_card_id === creditCardId &&
          e.installment_count === row.taksit_sayisi &&
          e.installment_index === row.taksit_index &&
          Math.abs(e.amount - row.tutar) <= tolerance,
        row.tarih,
      );
    }

    // 2) Dövizli — bu satır MÜKERRER DEĞİL, ÜSTÜNE YAZILACAK olan.
    const foreignMatch =
      !installmentMatch && row.taksit_index === null
        ? closestUnconsumed(
            existing,
            consumed,
            (e) =>
              isSpendKind(e) &&
              !!e.original_currency &&
              e.original_amount !== null &&
              cardCompatible(e) &&
              daysBetween(e.occurred_at, row.tarih) <= FX_DATE_WINDOW_DAYS &&
              Math.abs(e.amount - row.tutar) / Math.max(e.amount, row.tutar) <= FX_SPREAD_TOLERANCE,
            row.tarih,
          )
        : null;

    // 3) Sıradan TL harcaması.
    const plainMatch =
      !installmentMatch && !foreignMatch
        ? closestUnconsumed(
            existing,
            consumed,
            (e) =>
              isSpendKind(e) &&
              cardCompatible(e) &&
              daysBetween(e.occurred_at, row.tarih) <= DUPLICATE_DATE_WINDOW_DAYS &&
              Math.abs(e.amount - row.tutar) < DUPLICATE_AMOUNT_TOLERANCE,
            row.tarih,
          )
        : null;

    const matched = installmentMatch ?? foreignMatch ?? plainMatch;
    if (matched) consumed.add(matched.id);

    results.set(index, {
      possibleDuplicate: installmentMatch !== null || plainMatch !== null,
      // Kullanıcı NEDEN işaretlendiğini görebilmeli. Önceden yalnızca bir
      // "olası mükerrer" rozeti vardı ve neye dayandığı görünmüyordu; sezgisel
      // bir eşleştirmede gerekçeyi gizlemek kullanıcıyı ona güvenmek zorunda
      // bırakıyor. Tarih + tutar gösterilince kararı kendisi verebiliyor.
      duplicateOf: matched && !foreignMatch
        ? { occurred_at: matched.occurred_at, amount: matched.amount }
        : null,
      replaces: foreignMatch
        ? { id: foreignMatch.id, label: `${foreignMatch.original_amount} ${foreignMatch.original_currency}` }
        : null,
    });
  }

  // Yalnızca EŞLEŞTİRME döner; "hangi satır varsayılan olarak işaretli"
  // kararı çağıranın (StatementUploadSheet) işi — o karar arayüz davranışı,
  // bu modül ise saf veri eşleştirmesi.
  return rows.map((_row, index) => results.get(index)!);
}
