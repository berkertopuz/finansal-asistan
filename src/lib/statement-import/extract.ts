import { getDocumentProxy } from "unpdf";

export type StatementHeader = {
  statementDate: string | null; // YYYY-MM-DD
  paymentDueDate: string | null; // YYYY-MM-DD
};

export type ExtractedStatement = {
  header: StatementHeader;
  transactionText: string;
};

// Her banka ekstresinin işlem tablosu başlığını farklı yazması bekleniyor —
// yeni bir banka eklemek bu diziye bir satır eklemekle sınırlı kalsın diye
// (CLAUDE.md'nin "küçük bir yeni konfigürasyon" hedefi). fullText üzerinde
// sırayla denenir, en az bir eşleşme veren ilk desen kazanır — segment
// ayırma/sayfa geçişi mantığı (extractStatementText içindeki döngü) hepsi
// için ortak.
const TABLE_START_PATTERNS: RegExp[] = [
  // Enpara: "İşlem tarihi Açıklama Taksit Tutar"
  /İşlem tarihi\s*Açıklama\s*Taksit\s*Tutar/gi,
  // QNB Xtra: "İşlem Tarihi İşlem Açıklaması Tutar Taksit ParaPuan" —
  // extractRawText'in QNB_FONT_CODE_MAP düzeltmesi sayesinde artık gerçek
  // haliyle okunabiliyor, ayrı bir "bozuk metni atla" deseni gerekmiyor.
  /İşlem Tarihi\s*İşlem Açıklaması\s*Tutar\s*Taksit\s*ParaPuan/gi,
];

const TABLE_END_MARKERS = [
  /Sayfa\s+\d+\s*\/\s*\d+/i,
  /Kart sahibinin T\.C\. kimlik/i,
  /Bir sonraki ekstrenizin tarihi/i,
  /BSMV ve KKDF tutarlarına/i,
  // QNB: işlem tablosunun son sayfası "Genel Toplam" ile biter, hemen
  // ardından hesap özeti ve TCKN'li imza bloğu gelir.
  /Genel Toplam/i,
  // Bankadan bağımsız son güvenlik ağı: QNB'de her sayfanın altbilgisi
  // (banka adı, TCKN, sicil no...) "Sayfa X / Y" işaretinden ÖNCE geliyor
  // (gerçek bir QNB ekstresi üzerinde doğrulandı) — üstteki desenlerden
  // hiçbiri bir sayfa altbilgisini durduramazsa bile, "TCKN:" (T.C. Kimlik
  // Numarası) ifadesinin göründüğü her yer kimlik bloğunun başladığı
  // anlamına gelir; hangi banka olursa olsun kesip atmak güvenli.
  /TCKN\s*:/i,
];

// \s* (sıfır ya da daha fazla), \s+ değil: extractRawText artık pdf.js'in
// getTextContent()'i yerine ham glyph akışını kullanıyor (bkz. aşağısı) —
// unpdf'in extractText()'i konum farkına bakıp senkron bir boşluk eklerken
// (ör. "Ekstre tarihi 05/07/2026"), ham akışta iki kelime arasında gerçek
// bir boşluk glyph'i yoksa hiç boşluk kalmıyor ("Ekstre tarihi05/07/2026",
// gerçek Enpara PDF'i üzerinde doğrulandı) — \s+ bu durumda hiç eşleşmezdi.
const STATEMENT_DATE_PATTERNS = [
  /Ekstre tarihi\s*(\d{2}\/\d{2}\/\d{4})/i, // Enpara
  /Hesap Kesim Tarihi\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i, // QNB
];

// Sayısal (Enpara: "Son ödeme tarihi 25/05/2026") ve yazıyla (QNB: "Son
// Ödeme Tarihi: 25 Mayıs 2026, Pazartesi") iki farklı biçim var; ikisini
// tek bir regex'e sığdırmak yerine ayrı ayrı deneniyor.
const DUE_DATE_NUMERIC_PATTERNS = [
  /Son ödeme tarihi\s*(\d{2}\/\d{2}\/\d{4})/i, // Enpara
];
const DUE_DATE_WRITTEN_PATTERN = /Son\s+Ödeme\s+Tarihi\s*:?\s*(\d{1,2})\s+(\p{L}+)\s+(\d{4})/iu; // QNB

const TURKISH_MONTHS: Record<string, string> = {
  ocak: "01",
  şubat: "02",
  subat: "02",
  mart: "03",
  nisan: "04",
  mayıs: "05",
  mayis: "05",
  haziran: "06",
  temmuz: "07",
  ağustos: "08",
  agustos: "08",
  eylül: "09",
  eylul: "09",
  ekim: "10",
  kasım: "11",
  kasim: "11",
  aralık: "12",
  aralik: "12",
};

// Bazı bankaların (şu ana kadar sadece QNB Xtra) PDF'lerinde gömülü font,
// Türkçe'ye özgü harfleri metin katmanına hiç aktarmıyor — pdf.js bu
// glyph'leri BULABİLİYOR (fontta gerçekten var, bir genişliği/şekli var,
// `isInFont: true`) ama Unicode karşılığını çözemediği için ham karakter
// kodunu (0, 1, 2, ...) döndürüyor, extractRawText de bunu boş bırakır ya
// da tutarsız bir karaktere düşürür. Bu tablo, gerçek bir QNB ekstresi
// üzerinde bu ham kodları düzinelerce kelimede (Müşteri, Dönem, İşlem,
// Açıklaması, İstanbul, Şişli, Üniversite, Öğrenci, Bağdat, Kağan, Şirketi
// gibi) çapraz doğrulayarak elle çıkarıldı — SADECE bu embedded fontun kod
// sırası için geçerli; başka bir bankanın aynı sorunu yaşaması, kendi kod
// tablosunu gerektirir (glyph kodları fonta özel, evrensel bir standart
// değil). Kod 12 tek bir yerde (bir mağaza adında) göründü ve hiçbir bilinen
// kelimeyle güvenle eşleşmedi — yanlış tahmin etmek yerine haritanın dışında
// bırakıldı, o karakter (öncekiyle aynı şekilde) boş kalır.
const QNB_FONT_CODE_MAP: Record<number, string> = {
  0: "ü",
  1: "ş",
  2: "ö",
  3: "Ö",
  4: "Ö",
  5: "ğ",
  7: "İ",
  8: "Ç",
  9: "Ş",
  10: "İ",
  11: "Ü",
  13: "ş",
  14: "ç",
  15: "Ü",
  16: "ö",
  17: "ğ",
  19: "Ğ",
};

type PDFDocumentLike = Awaited<ReturnType<typeof getDocumentProxy>>;
type Glyph = { originalCharCode?: number; unicode?: string };

function isGlyphArray(value: unknown): value is Glyph[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "originalCharCode" in (value[0] as object)
  );
}

// unpdf'in extractText()'i pdf.js'in getTextContent() API'si üzerinden
// çalışıyor — bu API, Unicode'a çözülemeyen glyph'leri (QNB'nin fontundaki
// gibi) ya tamamen düşürüyor ya da (gerçek PDF üzerinde doğrulandı)
// TUTARSIZ bir şekilde farklı/yanlış kodlar veriyor, çünkü kendi iç metin
// gruplama mantığı bu glyph'leri beklenmedik yerlerde bölüyor.
// getOperatorList() (pdf.js'in daha alt seviyeli, ham içerik akışı API'si)
// her glyph için orijinal karakter kodunu HER ZAMAN aynı ve tutarlı şekilde
// koruyor — QNB_FONT_CODE_MAP ile düzeltmeyi bu yüzden burada, extractText()
// yerine bu fonksiyonda yapıyoruz. Enpara'nın PDF'inde bu şekilde düşen
// glyph hiç yok (doğrulandı: 0 kontrol karakteri çıktı) ve buradaki metin
// unpdf'in kendi extractText()'iyle üretilenle aynı — bu fonksiyon extractText()'in
// tam yerine güvenle geçiyor, iki ayrı yol tutmaya gerek yok.
async function extractRawText(pdf: PDFDocumentLike): Promise<string> {
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const opList = await page.getOperatorList();
    for (let i = 0; i < opList.fnArray.length; i++) {
      const args: unknown = opList.argsArray[i];
      if (!Array.isArray(args) || !isGlyphArray(args[0])) continue;
      for (const g of args[0]) {
        const uni = g.unicode ?? "";
        if (uni.length === 1 && uni.charCodeAt(0) < 32 && g.originalCharCode !== undefined) {
          fullText += QNB_FONT_CODE_MAP[g.originalCharCode] ?? "";
        } else {
          fullText += uni;
        }
      }
    }
    fullText += "\n";
  }
  return fullText;
}

function toIsoDateFromDDMMYYYY(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

function toIsoDateFromWritten(day: string, monthName: string, year: string): string | null {
  const month = TURKISH_MONTHS[monthName.toLocaleLowerCase("tr")];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function extractStatementDate(fullText: string): string | null {
  for (const pattern of STATEMENT_DATE_PATTERNS) {
    const m = fullText.match(pattern);
    if (m) return toIsoDateFromDDMMYYYY(m[1]);
  }
  return null;
}

function extractDueDate(fullText: string): string | null {
  for (const pattern of DUE_DATE_NUMERIC_PATTERNS) {
    const m = fullText.match(pattern);
    if (m) return toIsoDateFromDDMMYYYY(m[1]);
  }
  const written = fullText.match(DUE_DATE_WRITTEN_PATTERN);
  if (written) return toIsoDateFromWritten(written[1], written[2], written[3]);
  return null;
}

function findTableEnd(text: string, from: number): number {
  let earliest = text.length;
  for (const marker of TABLE_END_MARKERS) {
    const m = new RegExp(marker.source, marker.flags.replace("g", "")).exec(text.slice(from));
    if (m) earliest = Math.min(earliest, from + m.index);
  }
  return earliest;
}

// PDF'in TÜM metnini (`fullText`) yalnızca bu fonksiyon içinde, yerel olarak
// görür — ad soyad, TC kimlik no, kart numarası, adres dahil hiçbir kısmı bu
// fonksiyonun dışına çıkmaz. Dönen `transactionText` sadece işlem tablosu
// satırlarını, `header` sadece iki tarihi (kimlikle ilişkilendirilemez)
// içerir — çağıran taraf (src/app/api/statements/parse/route.ts) bunun
// dışında hiçbir şeye erişemez, LLM'e yalnızca bu ikisi gider.
export async function extractStatementText(pdfBuffer: ArrayBuffer): Promise<ExtractedStatement> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const fullText = await extractRawText(pdf);

  const segments: string[] = [];
  for (const tableStart of TABLE_START_PATTERNS) {
    tableStart.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tableStart.exec(fullText))) {
      const segmentStart = match.index + match[0].length;
      const segmentEnd = findTableEnd(fullText, segmentStart);
      const rawSegment = fullText.slice(segmentStart, segmentEnd).trim();
      // Bazı bankalar (QNB) tablo başlığı ile ilk gerçek işlemin arasına
      // "Önceki Dönem Bakiyeniz ... ASIL KART: [maskeli kart no] - [AD
      // SOYAD]" gibi bir özet+kimlik satırı sıkıştırıyor (gerçek bir QNB
      // ekstresi üzerinde doğrulandı) — segmenti ilk tarihten önce hiç
      // başlatmamak, bu satırın (dolayısıyla içindeki adın/kart no'nun)
      // LLM'e giden metne hiç girmemesini garantiliyor; ayrıca tarihsiz
      // özet satırlarını zaten atması gereken LLM'e bir yük daha bindirmiyor.
      const firstDate = rawSegment.match(/\d{2}\/\d{2}\/\d{4}/);
      const segment = firstDate ? rawSegment.slice(rawSegment.indexOf(firstDate[0])) : rawSegment;
      // PDF metni satır sonlarını korumadan tek bir düz metne akıyor —
      // "Bir önceki ekstre bakiyeniz 16.163,36 TL 15/06/2026 Ödeme..." gibi bir
      // satırın tutarı, hemen ardından gelen satırın tarihine bitişik kalıyor.
      // Bu, LLM'in "önceki satırın tutarı mı, yoksa bu satırın bir parçası mı"
      // belirsizliğine düşüp bazen bir satırı tamamen atlamasına yol açtı
      // (gerçek PDF üzerinde gözlendi). Her tarihten önce satır sonu ekleyerek
      // her işlemi kendi satırına ayırmak bu belirsizliği kökten kaldırıyor —
      // LLM'e güvenmek yerine deterministik bir düzeltme.
      segments.push(segment.replace(/(\d{2}\/\d{2}\/\d{4})/g, "\n$1").trim());
    }
    if (segments.length > 0) break; // ilk eşleşen format kazanır, diğer bankaların desenini hiç denemiyoruz
  }

  return {
    header: {
      statementDate: extractStatementDate(fullText),
      paymentDueDate: extractDueDate(fullText),
    },
    transactionText: segments.join("\n"),
  };
}
