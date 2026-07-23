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

// QNB Xtra'nın PDF'lerinde gömülü font, Türkçe'ye özgü harfleri metin
// katmanına hiç aktarmıyor — pdf.js bu glyph'leri BULABİLİYOR (fontta
// gerçekten var, bir genişliği/şekli var, `isInFont: true`) ama Unicode
// karşılığını çözemediği için ham karakter kodunu (0, 1, 2, ...) döndürüyor.
// Bu ham kod aralığı (0-31, ASCII kontrol karakterleri bandı — normal
// yazdırılabilir font 32'den, boşluktan başlıyor) HER AYKI ekstrede aynı
// bantta kalıyor, ama kod↔harf eşleşmesi HER PDF'te farklı: font her ay
// yeniden "subset" ediliyor ve bu bandın içindeki 20'ye yakın ekstra glyph,
// o belgede hangi harflerin geçtiğine göre yeniden numaralanıyor. İki farklı
// aya ait gerçek QNB ekstresi karşılaştırılarak doğrulandı — aynı kod (ör.
// 19), bir belgede "Ğ", başka bir belgede "ö" karşılığı çıktı. Bu yüzden
// sabit bir kod→harf tablosu yalnızca çıkarıldığı belgede çalışıyordu.
//
// Çözüm: sabit tablo yerine HER PDF için kendi haritasını, o PDF'in metni
// üzerinde banka şablonundan gelen (kullanıcıdan kullanıcıya değişmeyen)
// sabit etiket/ibareleri (ör. "Müşteri Numarası", "Asgari Ödeme Tutarı",
// altbilgideki "Telefon Bankacılığı: 0850 222 0 900") arayarak kalibre
// ediyoruz — bkz. QNB_CALIBRATION_ANCHORS. Bir kod hiçbir çapaya denk
// gelmediyse (ör. yalnızca bir müşteri adında/adresinde geçen nadir bir
// harf) o karakter boş bırakılır; adres/isim bloğu zaten transactionText'e
// hiç dahil edilmiyor (bkz. extractStatementText), o yüzden bu sınırlama
// işlem verisini etkilemiyor.
const QNB_MARKER_BASE = 0xe000; // Unicode Private Use Area — gerçek metinle asla çakışmaz

function qnbMarker(code: number): string {
  return String.fromCodePoint(QNB_MARKER_BASE + code);
}
function qnbCodeFromMarker(marker: string): number {
  return marker.codePointAt(0)! - QNB_MARKER_BASE;
}
const QNB_MARKER_PATTERN = "[-]";
const QNB_MARKER_RE = new RegExp(QNB_MARKER_PATTERN);
const QNB_MARKER_RE_GLOBAL = new RegExp(QNB_MARKER_PATTERN, "g");

// Her kural: banka şablonunun gerçek iki farklı aya ait ekstrede birebir
// aynı çıktığı doğrulanmış bir ibare, çözülecek harflerin konumunda tek
// karakterlik yakalama grubuyla. groups.length, regex'teki yakalama grubu
// sayısıyla aynı sırada eşleşmeli.
//
// Bilinen sınırlama: "Ğ" (büyük) için hiçbir sabit/şablon ibaresinde
// güvenilir bir çapa bulunamadı — iki gerçek ekstrede de yalnızca işlem
// açıklamalarında geçiyordu (ör. "KAĞAN", "BAĞDAT", "...OĞLU"), hiçbir
// zaman banka şablonunun sabit kısmında değil. Kalibrasyon bu harfi
// çözemezse o glyph (mevcut "belirsiz kod" davranışıyla tutarlı şekilde)
// boş bırakılır — işlem tutarı/tarihi gibi kritik alanları etkilemez,
// yalnızca ilgili satırdaki bir harf eksik görünür.
const QNB_CALIBRATION_ANCHORS: { pattern: RegExp; letters: string[] }[] = [
  { pattern: new RegExp(`M(${QNB_MARKER_PATTERN})(${QNB_MARKER_PATTERN})teri Numaras`), letters: ["ü", "ş"] },
  { pattern: new RegExp(`Asgari (${QNB_MARKER_PATTERN})deme Tutar`), letters: ["Ö"] },
  { pattern: new RegExp(`Asgari (${QNB_MARKER_PATTERN})deme Oran`), letters: ["Ö"] },
  { pattern: new RegExp(`Kar(${QNB_MARKER_PATTERN})ılı(${QNB_MARKER_PATTERN})ı`), letters: ["ş", "ğ"] },
  { pattern: new RegExp(`Kazanılan (${QNB_MARKER_PATTERN})zel ParaPuan`), letters: ["Ö"] },
  { pattern: new RegExp(`Son (${QNB_MARKER_PATTERN})deme Tarihi`), letters: ["Ö"] },
  {
    pattern: new RegExp(`(${QNB_MARKER_PATTERN})nceki D(${QNB_MARKER_PATTERN})nem Bakiyeniz`),
    letters: ["Ö", "ö"],
  },
  { pattern: new RegExp(`(${QNB_MARKER_PATTERN})(${QNB_MARKER_PATTERN})lem Tarihi`), letters: ["İ", "ş"] },
  { pattern: new RegExp(`A(${QNB_MARKER_PATTERN})ıklaması`), letters: ["ç"] },
  { pattern: new RegExp(`Bankacılı(${QNB_MARKER_PATTERN})ı: 0850`), letters: ["ğ"] },
  { pattern: new RegExp(`Ticaret Unvanı: QNB Bank A\\.(${QNB_MARKER_PATTERN})\\.`), letters: ["Ş"] },
  { pattern: new RegExp(`B(${QNB_MARKER_PATTERN})y(${QNB_MARKER_PATTERN})kdere Cad`), letters: ["ü", "ü"] },
  {
    pattern: new RegExp(`215 (${QNB_MARKER_PATTERN})i(${QNB_MARKER_PATTERN})li/(${QNB_MARKER_PATTERN})stanbul`),
    letters: ["Ş", "ş", "İ"],
  },
  { pattern: new RegExp(`Nakit Avans(${QNB_MARKER_PATTERN})cretler`), letters: ["Ü"] },
  { pattern: new RegExp(`Nakit (${QNB_MARKER_PATTERN})ekim`), letters: ["Ç"] },
  { pattern: new RegExp(`Hesap (${QNB_MARKER_PATTERN})zetiniz`), letters: ["Ö"] },
  { pattern: new RegExp(`son (${QNB_MARKER_PATTERN})deme tarihiniz`), letters: ["ö"] },
  { pattern: new RegExp(`Alı(${QNB_MARKER_PATTERN})veri(${QNB_MARKER_PATTERN})Faizi`), letters: ["ş", "ş"] },
];

// "Ğ" için hiçbir şablon ibaresinde çapa yok (bkz. yukarıdaki not), ama
// iki farklı aya ait gerçek QNB ekstresinde de bu glyph'in font genişliği
// (width) hep 778 çıktı — tesadüfen "Ö" ile aynı genişlik, ama "Ö" zaten
// yukarıdaki çok sayıda güçlü çapayla neredeyse her zaman çözülüyor. Bu
// yüzden kalibrasyondan sonra HÂLÂ çözülememiş bir kod 778 genişlikteyse,
// bunun "Ğ" olma ihtimali yüksek — boş bırakmaktansa "Ğ" ile doldurmak
// (kullanıcı isteği: bariz merchant adlarında — "KAĞAN", "BAĞDAT",
// "...OĞLU" — harfin tamamen düşmesindense yanlış büyük/küçük ihtimaline
// razı olunması) daha okunaklı bir sonuç veriyor. Diğer çözülemeyen kodlar
// (ör. genişliği "Ç"/"Ü" ile çakışan, gerçekten belirsiz "12" kodu) bu
// genişlik-tahmini kapsamına alınmıyor — orada birden fazla harf aynı
// genişliği paylaşıyor, yanlış tahmin riski yüksek.
const QNB_GHE_WIDTH = 778;

function calibrateQnbCodeMap(markedText: string, codeWidths: Map<number, number>): Record<number, string> {
  const map: Record<number, string> = {};
  for (const { pattern, letters } of QNB_CALIBRATION_ANCHORS) {
    const match = pattern.exec(markedText);
    if (!match) continue;
    letters.forEach((letter, i) => {
      const code = qnbCodeFromMarker(match[i + 1]);
      map[code] = letter;
    });
  }
  for (const [code, width] of codeWidths) {
    if (!(code in map) && width === QNB_GHE_WIDTH) map[code] = "Ğ";
  }
  return map;
}

// Bir belgede hiç çözülemeyen (kalibrasyon çapası bulunamayan, genişlikle de
// tahmin edilemeyen) glyph boş bırakılır — yanlış tahmin etmek, sessizce
// yanlış bir harf yazmaktan (ör. yanlış bir işlem tutarının/tarihinin LLM'e
// gitmesi) daha güvenli.
function resolveQnbMarkers(markedText: string, codeWidths: Map<number, number>): string {
  if (!QNB_MARKER_RE.test(markedText)) return markedText;
  const codeMap = calibrateQnbCodeMap(markedText, codeWidths);
  return markedText.replace(QNB_MARKER_RE_GLOBAL, (marker) => codeMap[qnbCodeFromMarker(marker)] ?? "");
}

type PDFDocumentLike = Awaited<ReturnType<typeof getDocumentProxy>>;
type Glyph = { originalCharCode?: number; unicode?: string; width?: number };

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
// gibi) ya tamamen düşürüyor ya da (gerçek PDF üzerinde doğrulandı) TUTARSIZ
// bir şekilde farklı/yanlış kodlar veriyor. getOperatorList() (pdf.js'in daha
// alt seviyeli, ham içerik akışı API'si) her glyph için orijinal karakter
// kodunu HER ZAMAN aynı ve tutarlı şekilde koruyor — düzeltmeyi bu yüzden
// extractText() yerine burada, ham glyph akışı üzerinde yapıyoruz.
//
// originalCharCode < 32 (ASCII kontrol bandı) QNB'de "fontun standart
// WinAnsi düzenine sığmayan, sona eklenmiş ekstra Türkçe glyph'ler" için
// ayrılmış — ama bu EVRENSEL bir pdf.js/font kuralı değil, QNB'ye özel bir
// alt-kümeleme (subsetting) tercihi. Gerçek bir Enpara ekstresi üzerinde bu
// bandın Enpara'da TAM TERSİNE sıradan harfler (E, k, s, t, r, e, rakamlar...)
// için kullanıldığı ve `g.unicode`'un bunlarda HER ZAMAN doğru olduğu
// doğrulandı — yani bu bandı körü körüne "bozuk" sayıp QNB_MARKER'a
// çevirmek Enpara'yı bozuyordu (regresyon, gerçek PDF ile yakalandı).
// Çözüm: önce EVRENSEL güvenli kuralla (yalnızca g.unicode'un KENDİSİ bir
// kontrol karakteriyse şüpheli say — orijinal, ilk sürümdeki kural) bir
// "safeText" kur; "QNB" imzası bu bantta hiçbir zaman bozulmuyor (Q/N/B
// hep normal, >=32 kodlu glyph'ler), o yüzden bankayı safeText üzerinden
// güvenle tespit edebiliyoruz. QNB tespit edilirse, ham glyph akışını BU
// SEFER originalCharCode < 32 olan HER glyph için (g.unicode ne derse
// desin) QNB_MARKER'a çevirip kalibrasyona bırakan agresif kuralla yeniden
// kuruyoruz — çünkü QNB'de bu bandın unicode tahmini bazen kontrol
// karakterine, bazen yanlış ama okunaklı görünen bir harfe düşüyor, salt
// "kontrol karakteri mi" testi ikincisini yakalayamıyor.
async function extractRawText(pdf: PDFDocumentLike): Promise<string> {
  let safeText = "";
  let aggressiveText = "";
  const codeWidths = new Map<number, number>();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const opList = await page.getOperatorList();
    for (let i = 0; i < opList.fnArray.length; i++) {
      const args: unknown = opList.argsArray[i];
      if (!Array.isArray(args) || !isGlyphArray(args[0])) continue;
      for (const g of args[0]) {
        const uni = g.unicode ?? "";
        const looksBroken = uni.length === 1 && uni.charCodeAt(0) < 32;
        safeText += looksBroken ? "" : uni;
        if (g.originalCharCode !== undefined && g.originalCharCode < 32) {
          aggressiveText += qnbMarker(g.originalCharCode);
          if (g.width !== undefined) codeWidths.set(g.originalCharCode, g.width);
        } else {
          aggressiveText += uni;
        }
      }
    }
    safeText += "\n";
    aggressiveText += "\n";
  }
  return safeText.includes("QNB") ? resolveQnbMarkers(aggressiveText, codeWidths) : safeText;
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
