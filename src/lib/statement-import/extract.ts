import { getDocumentProxy } from "unpdf";
import { classifyLines, splitOnDates } from "./classify";
import { decodeEbcdic, looksLikeEbcdic } from "./ebcdic";
import { extractPositionedLines } from "./layout";
import { buildStatementMarkdown } from "./markdown";

export type ExtractedStatement = {
  /** LLM'e gönderilecek, maskelenmiş ve şekil-filtresinden geçmiş markdown. */
  markdown: string;
  /** Whitelist'ten geçen aday işlem satırı sayısı (0 ise ayrıştırma başarısız). */
  transactionCount: number;
};

// TASARIM NOTU — banka başına konfigürasyon neden KALDIRILDI
//
// Bu dosya eskiden dört tane banka-özel knob taşıyordu: TABLE_START_PATTERNS
// (her bankanın işlem tablosu başlığı), STATEMENT_DATE_PATTERNS ve
// DUE_DATE_* (her bankanın tarih etiketleri) ve TABLE_END_MARKERS. Yeni bir
// banka desteklemek, o bankaya ait gerçek bir PDF'i ele geçirip bu dizilere
// satır eklemek anlamına geliyordu — Play Store'a çıkacak bir uygulama için
// sürdürülemez (kullanıcı her bankadan örnek ekstre toplayamıyor).
//
// Yerine geçen şey: classify.ts'teki ŞEKİL temelli whitelist. Whitelist
// mantığı (yalnızca eşleşen satırlar LLM'e çıkar, gerisi atılır) aynen
// korunuyor — değişen tek şey, eşleşme kriterinin banka etiketi yerine
// "tarihle başlar + tutar içerir" gibi bankadan bağımsız bir şekil olması.
// Kesim/son ödeme tarihini artık regex bulmuyor: özet alanları aday olarak
// LLM'e veriliyor, hangisinin ne olduğuna o karar veriyor.
//
// GİZLİLİK: whitelist blacklist'e ÇEVRİLMEDİ. "Her şeyi gönder, PII'yi
// maskele" tasarımı reddedildi — maskeleyicinin kaçırdığı bir ad/adres
// doğrudan OpenAI'a giderdi ve Türkçe ad/adres'i regex ile güvenilir
// yakalamak mümkün değil (merchant adları da BÜYÜK HARF). Ad/adres blokları
// hâlâ *yapısal olarak* elenir: içlerinde ne tarih ne tutar olduğu için
// hiçbir kovaya girmezler. mask.ts bunun üstüne ikinci katman.
//
// QNB'nin kırık fontu için aşağıdaki kalibrasyon makinesi olduğu gibi
// korundu, ama artık bir ÖNKOŞUL değil, opsiyonel bir iyileştirme: o
// mekanizma çözemediği glyph'i boş bırakıyor, ve bozuk glyph'ler yalnızca
// harfleri etkiliyor (rakamlar >= 32 kodlu normal glyph'ler) — yani
// bilinmeyen bir bankada kırık font varsa tarihler ve tutarlar %100 doğru
// çıkar, sadece merchant adında bir harf eksilir. Genericlik tam buradan
// geliyor.

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
  { pattern: new RegExp(`Nakit Avans\\s*(${QNB_MARKER_PATTERN})cretler`), letters: ["Ü"] },
  { pattern: new RegExp(`Nakit (${QNB_MARKER_PATTERN})ekim`), letters: ["Ç"] },
  { pattern: new RegExp(`Hesap (${QNB_MARKER_PATTERN})zetiniz`), letters: ["Ö"] },
  { pattern: new RegExp(`son (${QNB_MARKER_PATTERN})deme tarihiniz`), letters: ["ö"] },
  { pattern: new RegExp(`Alı(${QNB_MARKER_PATTERN})veri(${QNB_MARKER_PATTERN})Faizi`), letters: ["ş", "ş"] },

  // Büyük "Ü" için ek çapalar. Neden gerekti: bu PDF birden fazla font
  // alt-kümesi gömüyor (özet bloğu, işlem tablosu ve altbilgi ayrı fontlar) ve
  // AYNI harf her fontta farklı bir kod alıyor — yani tek bir çapa bir harfi
  // yalnızca TEK bir fontta çözüyor. Gerçek bir QNB ekstresinde "Ü" üç ayrı
  // kodda geçti: yukarıdaki "Nakit AvansÜcretler" çapası bunlardan yalnızca
  // birini çözdü, işlem tablosu ve altbilgi fontlarındaki "Ü" boş kaldı
  // ("GÜMÜŞSUYU" -> "GMSUYU", "GÜMRÜKSÜZ" -> "GMRKSZ" olarak göründü,
  // kullanıcı bildirdi).
  //
  // "Ücretler" (çoğul) ile "Ücreti" (tekil) birbirini dışlayan iki desen:
  // "cretler" ve "creti" ortak bir önekten sonra ayrıştığı için biri diğerinin
  // metnine eşleşmiyor — ikisi ayrı çapa olmak zorunda, yoksa exec() ilk
  // eşleşmede durup ikinci fontun kodunu hiç görmüyor.
  { pattern: new RegExp(`Nakit Avans\\s*(${QNB_MARKER_PATTERN})creti`), letters: ["Ü"] },
  { pattern: new RegExp(`Kampanyası\\s*(${QNB_MARKER_PATTERN})creti`), letters: ["Ü"] },
  // Altbilgideki yıllık üyelik ücreti bildirimi — bankanın sabit yasal metni,
  // gerçek ekstrede 7 kez tekrarlıyor, tek satırda iki "Ü" veriyor.
  {
    pattern: new RegExp(`yıllık\\s*(${QNB_MARKER_PATTERN})yelik\\s*(${QNB_MARKER_PATTERN})creti`),
    letters: ["Ü", "Ü"],
  },
  // "SÖZLEŞME DEĞİŞİKLİĞİ BİLDİRİMİ" altbilgi başlığı — büyük harf "Ş" için
  // şablonda bulunan tek güvenilir çapa (diğer "Ş" geçişleri merchant
  // adlarında, yani kullanıcıya özel).
  { pattern: new RegExp(`S(${QNB_MARKER_PATTERN})ZLE(${QNB_MARKER_PATTERN})ME`), letters: ["Ö", "Ş"] },
  // Özet bloğundaki "Dönem Borcu" etiketi — küçük "ö"nün özet fontundaki kodu.
  { pattern: new RegExp(`D(${QNB_MARKER_PATTERN})nem Borcu`), letters: ["ö"] },
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
//
// Bu fonksiyon yalnızca ÇIKARIR, onarmaz: iki okumayı da (güvenli + agresif)
// ve genişlik tablosunu ham haliyle döndürür, hangisinin kullanılacağına
// repairSubsetFont karar verir. Onarımın burada değil dışarıda durmasının
// sebebi, ikinci bir onarımın (EBCDIC, bkz. ebcdic.ts) var olması: ikisi de
// aynı sınıf problemi çözüyor ("PDF'in kodları Unicode'a çözülmüyor") ve
// extractStatementText'te yan yana okunmaları gerekiyor. Biri glyph
// metadata'sına muhtaç olduğu için burada, diğeri düz metin üzerinde
// çalıştığı için orada duruyor olsaydı, aynı iş iki farklı katmana
// dağılmış olurdu.
type RawGlyphStream = {
  /** EVRENSEL güvenli kuralla kurulmuş metin — banka tespiti bunun üzerinden. */
  safeText: string;
  /** originalCharCode < 32 olan HER glyph'in PUA işaretine çevrildiği metin. */
  markedText: string;
  /** İşaretlenen kodların font genişlikleri — "Ğ" genişlik tahmini için. */
  codeWidths: Map<number, number>;
};

async function extractRawGlyphStream(pdf: PDFDocumentLike): Promise<RawGlyphStream> {
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
  return { safeText, markedText: aggressiveText, codeWidths };
}

// ONARIM 1/2 — belge başına yeniden numaralanan alt-küme fontu (QNB).
// Girdisi ham glyph akışı, çünkü hem orijinal karakter koduna hem font
// genişliğine ihtiyacı var; bu yüzden yalnızca işlem metnine uygulanabiliyor
// (konumlu satırlar getTextContent'ten geliyor, orada bu metadata yok).
function repairSubsetFont(stream: RawGlyphStream): string {
  return stream.safeText.includes("QNB")
    ? resolveQnbMarkers(stream.markedText, stream.codeWidths)
    : stream.safeText;
}

// PDF'in TÜM metnini (`fullText` ve `positionedLines`) yalnızca bu fonksiyon
// içinde, yerel olarak görür — ad soyad, TC kimlik no, kart numarası, adres
// dahil hiçbir kısmı bu fonksiyonun dışına çıkmaz. Dönen `markdown` yalnızca
// classify.ts'in şekil whitelist'inden geçen (ve mask.ts'ten geçirilmiş)
// satırları içerir; çağıran taraf (src/app/api/statements/parse/route.ts)
// bunun dışında hiçbir şeye erişemez, LLM'e yalnızca bu gider.
//
// İki metin çıkarma yolu kullanılır, ikisi de aynı PDF üzerinde:
//   - Ham glyph akışı (extractRawGlyphStream) → İŞLEM satırları. QNB'nin
//     kırık fontunu kurtarmanın tek yolu bu, karşılığında konum bilgisi yok;
//     ama her işlem satırı tarihle başladığı için splitOnDates deterministik
//     ve banka-bağımsız bir satırlaştırma sağlıyor.
//   - Konumlu metin (extractPositionedLines) → ÖZET satırları. Etiketin
//     nerede bitip adres bloğunun nerede başladığını bilmek için gerçek
//     satır yapısı gerekiyor; bunu yalnızca getTextContent'in x/y'si veriyor.
//
// Akış kasıtlı olarak üç adım: ÇIKAR → METİN KATMANINI ONAR → SINIFLANDIR.
// İki onarım da (alt-küme fontu, EBCDIC) burada, aynı katmanda yan yana
// duruyor. Ortak bir "codec" arayüzüne SOKULMADILAR: girdileri gerçekten
// farklı (biri glyph metadata'sı, diğeri düz metin) ve elimizde her
// türden birer örnek var — üçüncü bir onarım geldiğinde doğru soyutlamanın
// ne olduğu belli olur, o zamana kadar zorlamak sadece metadata'yı gereksiz
// yere ortak bir arayüzden geçirmek olurdu.
export async function extractStatementText(pdfBuffer: ArrayBuffer): Promise<ExtractedStatement> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  let fullText = repairSubsetFont(await extractRawGlyphStream(pdf));
  let positionedLines = await extractPositionedLines(pdf);

  // ONARIM 2/2 — AFP kökenli ekstrelerde metin katmanı EBCDIC; pdf.js ham
  // kodu Latin-1 olarak veriyor ("ðóaðòaòðòõ" = "03/02/2025"). Bu haliyle
  // şekil whitelist'i sıfır satır eşliyor (belgede hiç ASCII rakam yok), o
  // yüzden sınıflandırmadan ÖNCE çözmek gerekiyor. Düz metin üzerinde
  // çalıştığı için — ONARIM 1'in aksine — her iki çıkarma yoluna da
  // uygulanabiliyor. Tespit de çözüm de bankadan bağımsız, bkz. ebcdic.ts.
  if (looksLikeEbcdic(fullText)) {
    fullText = decodeEbcdic(fullText);
    positionedLines = positionedLines.map(decodeEbcdic);
  }

  const lines = classifyLines({
    transactionCandidates: splitOnDates(fullText),
    summaryCandidates: positionedLines,
  });

  return {
    markdown: buildStatementMarkdown(lines),
    transactionCount: lines.transactions.length,
  };
}
