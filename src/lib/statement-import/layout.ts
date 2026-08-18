// PDF'in metin katmanını KONUM bilgisiyle (x, y) satırlara geri çevirir.
//
// Neden ikinci bir metin çıkarma yolu var? extract.ts'in ana yolu pdf.js'in
// ham glyph akışını (getOperatorList) kullanıyor — bu, QNB'nin kırık
// fontundaki Türkçe harfleri kurtarmanın tek yolu (bkz. extract.ts'teki uzun
// not), ama karşılığında TÜM konum bilgisi kayboluyor: satır sonu yok, kelime
// araları yok ("Ekstre tarihi05/07/2026").
//
// Özet alanlarını ("Son Ödeme Tarihi: 25 Mayıs 2026") whitelist'e almak için
// gerçek satırlara ihtiyaç var — bir düz metin akışında "satır" diye bir şey
// olmadığı için etiketin nerede bitip adres bloğunun nerede başladığı
// bilinemez. getTextContent() her item için transform (x, y) veriyor;
// y'ye göre gruplamak satırları geri getiriyor, bankadan bağımsız.
//
// İş bölümü kasıtlı: İŞLEM satırları ham glyph yolundan (Türkçe harf
// doğruluğu korunur), ÖZET satırları bu yoldan (satır yapısı gerekir) gelir.
// QNB'de bu yolun Türkçe harfleri bozuk çıkıyor ama özet etiketleri ("Hesap
// Kesim Tarihi", "Son Odeme Tarihi") bozuk haliyle de LLM için okunabilir,
// ve DEĞERLER (tarih/tutar) rakam olduğu için hiç etkilenmiyor.

import type { getDocumentProxy } from "unpdf";

type PDFDocumentLike = Awaited<ReturnType<typeof getDocumentProxy>>;

// Aynı satır sayılmak için izin verilen dikey sapma (PDF birimi). Aynı
// baseline'daki item'lar teoride birebir aynı y'ye sahip, ama alt/üst simge
// ya da farklı font boyutları küçük farklar yaratabiliyor.
const LINE_Y_TOLERANCE = 2;

// Bu boşluktan (PDF birimi) genişse iki item arasına boşluk konur. Daha
// küçük boşluklar bir kelimenin/sayının parçalanmasıdır ("1.234" + "," +
// "56") ve birleştirilerek yazılır — aksi halde tutar desenleri bozulurdu.
const WORD_GAP = 1;

type PositionedItem = { x: number; y: number; width: number; text: string };

function isTextItem(item: unknown): item is { str: string; transform: number[]; width: number } {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    "transform" in item &&
    typeof (item as { str: unknown }).str === "string"
  );
}

function joinLine(items: PositionedItem[]): string {
  items.sort((a, b) => a.x - b.x);
  let line = "";
  let cursorX: number | null = null;
  for (const item of items) {
    if (cursorX !== null && item.x - cursorX > WORD_GAP && !line.endsWith(" ")) {
      line += " ";
    }
    line += item.text;
    cursorX = item.x + item.width;
  }
  return line.replace(/\s+/g, " ").trim();
}

/**
 * PDF'in tüm sayfalarındaki metin item'larını konumlarına göre satırlara
 * çevirir. Dönen satırlar HAM'dır — hiçbir filtreleme/maskeleme yapılmaz;
 * ad/adres satırları da bu listede vardır. Çağıran taraf (extract.ts) bunları
 * yalnızca classify.ts'in özet whitelist'inden geçirdikten sonra kullanır,
 * whitelist'ten geçmeyen hiçbir satır fonksiyonun dışına çıkmaz.
 */
export async function extractPositionedLines(pdf: PDFDocumentLike): Promise<string[]> {
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const items: PositionedItem[] = [];
    for (const item of content.items) {
      if (!isTextItem(item)) continue;
      if (item.str.trim() === "") continue;
      items.push({
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        text: item.str,
      });
    }

    // Yukarıdan aşağıya (PDF'te y aşağı doğru AZALIR), sonra soldan sağa.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    let current: PositionedItem[] = [];
    let currentY: number | null = null;
    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) <= LINE_Y_TOLERANCE) {
        current.push(item);
        currentY ??= item.y;
      } else {
        lines.push(joinLine(current));
        current = [item];
        currentY = item.y;
      }
    }
    if (current.length > 0) lines.push(joinLine(current));
  }
  return lines.filter(Boolean);
}
