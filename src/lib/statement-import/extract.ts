import { extractText, getDocumentProxy } from "unpdf";

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
  // QNB Xtra: "İşlem Tarihi İşlem Açıklaması Tutar Taksit ParaPuan" — bu
  // PDF'in gömülü fontu Türkçe'ye özgü harfleri (İ, ş, ç, ö, ü, ğ) metne
  // hiç aktarmıyor ("İşlem" → "lem", "Açıklaması" → "Aıklaması", gerçek bir
  // QNB ekstresi üzerinde doğrulandı) — bozulan orta kısmı birebir
  // eşleştirmeye çalışmak yerine, bozulmadan kalan "Tarihi" ile "Tutar
  // Taksit ParaPuan" arasındaki mesafeyi sınırlayarak atlıyoruz.
  /Tarihi[\s\S]{0,20}Tutar\s+Taksit\s+ParaPuan/gi,
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

const STATEMENT_DATE_PATTERNS = [
  /Ekstre tarihi\s+(\d{2}\/\d{2}\/\d{4})/i, // Enpara
  /Hesap Kesim Tarihi\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i, // QNB
];

// Sayısal (Enpara: "Son ödeme tarihi 25/05/2026") ve yazıyla (QNB: "Son
// [Ö]deme Tarihi: 25 Mayıs 2026, Pazartesi" — büyük "Ö" burada da font
// sorunuyla düşüyor) iki farklı biçim var; ikisini tek bir regex'e
// sığdırmak yerine ayrı ayrı deneniyor.
const DUE_DATE_NUMERIC_PATTERNS = [
  /Son ödeme tarihi\s+(\d{2}\/\d{2}\/\d{4})/i, // Enpara
];
// "deme Tarihi" ile başlıyor, "Ö" değil — QNB'nin bu PDF'inde her zaman
// düşüyor (bkz. TABLE_START_PATTERNS'teki not), o yüzden onu aramıyoruz.
const DUE_DATE_WRITTEN_PATTERN = /deme Tarihi\s*:?\s*(\d{1,2})\s+(\p{L}+)\s+(\d{4})/iu; // QNB

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
  const { text: fullText } = await extractText(pdf, { mergePages: true });

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
