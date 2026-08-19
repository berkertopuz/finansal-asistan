import { addMonthsClamped } from "@/lib/recurrence";
import { toDateString, type Entry } from "@/lib/ledger";

export type InstallmentRow = {
  occurred_at: string;
  amount: number;
  index: number;
  count: number;
};

// Splits `totalAmount` into `count` monthly rows starting at `anchorDateStr`
// (the purchase date, becomes taksit 1/N). Kuruş-exact: equal amounts except
// the last, which absorbs whatever the floor division left over — otherwise
// a series like 100/3 would drift a kuruş short of the real total.
export function buildInstallmentRows(
  totalAmount: number,
  count: number,
  anchorDateStr: string,
): InstallmentRow[] {
  const totalKurus = Math.round(totalAmount * 100);
  const baseKurus = Math.floor(totalKurus / count);
  const lastKurus = totalKurus - baseKurus * (count - 1);

  return Array.from({ length: count }, (_, i) => ({
    occurred_at: toDateString(addMonthsClamped(anchorDateStr, i)),
    amount: (i === count - 1 ? lastKurus : baseKurus) / 100,
    index: i + 1,
    count,
  }));
}

// ---------------------------------------------------------------------------
// Ekstreden gelen serilerin KALAN taksitleri — okuma anında türetilir
// ---------------------------------------------------------------------------

// Ekstre bize "11/12" diyorsa 12. taksitin geleceğini de söylemiş oluyor ve bu
// bir tahmin değil, kartın kesinleşmiş borcu. Ama o satırı içe aktarma anında
// deftere YAZMIYORUZ (denendi, geri alındı — bkz. src/lib/actions/statements.ts):
// ekstre otorite, projeksiyon tahmin; tahmini önceden yazınca gerçek satır
// geldiğinde uzlaştırmak gerekiyor ve her iki cevap da yanlış oluyor
// (11. taksit 300, banka 12.'yi 400 yazarsa: atlarsan 100 TL sessizce kaybolur,
// eklersen 300 fazla sayılır).
//
// Okuma anında türetmek bu problemi tamamen ortadan kaldırıyor: defterde
// yalnızca gerçekler durur, ağustos ekstresi gelince 12/12 normal bir satır
// olarak girer ve sentez kendiliğinden susar (aşağıdaki maxIndex kuralı).
//
// Elle girilen taksitlerle çakışmaz: onlarda seri baştan tam yazılıyor
// (buildInstallmentRows), yani maxIndex === count ve hiçbir şey üretilmez.
const PROJECTED_ID_PREFIX = "projected-installment:";

export function isProjectedInstallment(entry: Entry): boolean {
  return entry.id.startsWith(PROJECTED_ID_PREFIX);
}

/**
 * Bir grubun eksik kalan taksitlerini sentezler. YALNIZCA ileriye bakan
 * yüzeylerde kullanılır (taksit yükü grafiği, nakit akışı projeksiyonu) —
 * geçmişi/bu ayı raporlayan analizler (kategori kırılımı, harcama hızı)
 * gerçekleşmiş satırlarla çalışmaya devam eder.
 */
// Türkçe harfleri ASCII karşılıklarına indirger. toLocaleLowerCase("tr")
// KULLANILMIYOR: "İ" için birleştirici noktalı bir "i̇" (i + U+0307) üretiyor
// ve bu, düz "i" içeren aynı satıcı adıyla eşleşmiyor — gerçek bir testte
// "TODTV.COM.TR İSTANBUL" ile "todtv.com.tr istanbul trtr" bu yüzden farklı
// sayıldı ve hayalet bir taksit üretti.
const TR_FOLD: Record<string, string> = {
  ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g",
  ç: "c", Ç: "c", ö: "o", Ö: "o", ü: "u", Ü: "u",
};

// Aynı satıcı mı? Banka aynı işletmeyi ekstreden ekstreye küçük farklarla
// yazabiliyor: fazladan boşluk, büyük/küçük harf, noktalama, sondaki şehir/
// ülke eki ("... İSTANBUL TRTR").
function sameMerchant(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const norm = (v: string) =>
    v
      .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (ch) => TR_FOLD[ch] ?? ch)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export function projectRemainingInstallments(entries: Entry[]): Entry[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.installment_group_id === null) continue;
    if (entry.installment_index === null || entry.installment_count === null) continue;
    const list = groups.get(entry.installment_group_id);
    if (list) list.push(entry);
    else groups.set(entry.installment_group_id, [entry]);
  }

  const projected: Entry[] = [];
  for (const [groupId, rows] of groups) {
    const count = rows[0].installment_count!;
    // Serinin defterde duran EN İLERİ taksiti — sentez buradan sonrasını üretir.
    const last = rows.reduce((a, b) => (a.installment_index! >= b.installment_index! ? a : b));
    const lastIndex = last.installment_index!;
    if (lastIndex >= count) continue;

    for (let step = 1; step <= count - lastIndex; step++) {
      const index = lastIndex + step;
      // GRUP ID'SİNE GÜVENMEK YETMİYOR: her ekstre içe aktarması kendi
      // crypto.randomUUID()'sini üretiyor, yani aynı alışverişin 11. ve 12.
      // taksiti FARKLI gruplara düşüyor. Sadece gruba bakarsak, gerçek 12/12
      // ağustos ekstresiyle geldikten sonra bile temmuzun grubu hayalet bir
      // 12/12 üretmeye devam ediyordu — yani tam da kaçınmak istediğimiz çift
      // sayım. Bu yüzden üretmeden önce, o taksitin defterde GERÇEKTEN var
      // olup olmadığına bakıyoruz (aynı kart + aynı plan uzunluğu + aynı sıra
      // + aynı satıcı). Varsa sentez susuyor ve gerçek satır — bankanın
      // yazdığı tutarla — tek başına kalıyor.
      const alreadyRecorded = entries.some(
        (e) =>
          e.installment_count === count &&
          e.installment_index === index &&
          e.credit_card_id === last.credit_card_id &&
          sameMerchant(e.description, last.description),
      );
      if (alreadyRecorded) continue;

      projected.push({
        ...last,
        id: `${PROJECTED_ID_PREFIX}${groupId}:${index}`,
        occurred_at: toDateString(addMonthsClamped(last.occurred_at, step)),
        installment_index: index,
        // Tutar defterdeki son taksitten kopyalanıyor — elimizdeki en iyi
        // tahmin. Banka son taksite farklı bir kalan yazmışsa, gerçek satır
        // geldiği anda bu sentez yukarıdaki kontrolle tamamen susuyor ve
        // defterde bankanın tutarı kalıyor. Tahminle gerçeği uzlaştırmaya
        // çalışmıyoruz; gerçek gelince tahmin yok oluyor.
      });
    }
  }
  return projected;
}
