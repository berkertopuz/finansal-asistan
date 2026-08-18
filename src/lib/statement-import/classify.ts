import { MASK_MARKER_RE, maskPersonalData } from "./mask";

// Şekil temelli, BANKA-BAĞIMSIZ satır sınıflandırıcı — eski
// TABLE_START_PATTERNS / STATEMENT_DATE_PATTERNS / DUE_DATE_* üçlüsünün
// (her yeni banka için elde gerçek bir PDF + yeni regex gerektiren knob'lar)
// yerini alır.
//
// Dayandığı iki gözlem, hiçbir bankaya özgü değil:
//   1. Her işlem satırı bir TARİHLE başlar ve bir PARA TUTARI içerir.
//   2. Ad / adres / müşteri no / TCKN / imza blokları bu ikisini BİRDEN
//      içermez — dolayısıyla whitelist'ten yapısal olarak düşerler.
//
// Whitelist mantığı korunuyor (LLM'e yalnızca eşleşen satırlar çıkar,
// eşleşmeyen her şey atılır); değişen tek şey, eşleşme kriterinin banka
// etiketi yerine ŞEKİL olması.

// Tarih: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY ve iki haneli yıl varyantları.
// Eski kod yalnızca "\d{2}\/\d{2}\/\d{4}"ü tanıyordu — Enpara ve QNB ikisi de
// bu biçimi kullanıyordu, ama nokta ayırıcı Türk bankalarında en az o kadar
// yaygın, ve bu genelleme hiçbir şeyi bozmuyor.
//
// Gün 01-31, ay 01-12 olarak SINIRLI — salt `\d{1,2}` iki basamaklı ondalık
// akışının içine düşen sahte tarihler üretiyordu: gerçek bir QNB ekstresinin
// toplam satırındaki "NN.NN-NNN.NNN,NN" biçimli bir dizi "36.41-1988" gibi
// eşleşip splitOnDates'i orada böldü ve ortaya tarihle "başlayan", tutar
// içeren uydurma bir işlem adayı çıktı (gerçek PDF üzerinde gözlendi). Gün/ay
// aralığını daraltmak bu sınıfı tamamen eliyor.
//
// Kasıtlı olarak lookbehind (?<!\d) YOK: ham glyph akışında bir işlem
// satırının tarihi sıklıkla bir önceki satırın tutarına bitişik geliyor
// ("...TRTR246,9014/05/2026MAĞAZA ADI..."), yani rakamla ÖNCELENMİŞ bir tarih
// tamamen normal — onu reddetmek her sayfada işlem kaybettirirdi.
const DATE_SRC = String.raw`(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:\d{4}|\d{2})`;
export const DATE_RE = new RegExp(DATE_SRC);
export const DATE_RE_GLOBAL = new RegExp(DATE_SRC, "g");
const LEADING_DATE_RE = new RegExp(String.raw`^${DATE_SRC}`);

// Yalnızca bir tarihten (ve olası noktalama/boşluktan) oluşan parça — çok
// tarihli satır düzenlerinde ortaya çıkar, bkz. splitOnDates.
const BARE_DATE_RE = new RegExp(String.raw`^${DATE_SRC}[\s.,;|-]*$`);

// Bir işlem satırının önüne eklenecek en fazla çıplak tarih sayısı. İki tarih
// kolonu (işlem + valör) bilinen bir düzen; üçüncüsü bir düzen değil, bozuk
// metin işareti olurdu, o yüzden sınırsız biriktirmiyoruz.
const MAX_LEADING_DATES = 2;

// Yazıyla tarih ("25 Mayıs 2026") — QNB'nin son ödeme tarihi biçimi. Ay adını
// burada DOĞRULAMIYORUZ (eski DUE_DATE_WRITTEN_PATTERN + TURKISH_MONTHS
// tablosu yaptığı gibi): özet satırı sadece LLM'e aktarılacak bir aday, ay
// adını çözmek onun işi. Bu, ay adı tablosunu bakım yükünden çıkarıyor.
//
// Yıl (?:19|20)\d{2} olarak sınırlı, salt \d{4} değil: bu desen bir ADRES
// satırında da eşleşebiliyor ("... No 26 Kadıköy 34700" -> "26 Kadıköy
// 3470") ve özet kovasına bir adres parçası sokabilirdi. Yıl kısıtı, posta
// kodu/bina numarası gibi rakam kümelerini eliyor — ay adı tablosu tutmadan.
const WRITTEN_DATE_RE = /\d{1,2}\s+\p{L}{3,9}\s+(?:19|20)\d{2}/u;

// Para tutarı — hem Türkçe (1.234,56) hem uluslararası (1,234.56) biçim.
// Sondaki tam iki basamak zorunlu; "11/12" gibi taksit göstergeleri ya da
// "2026" gibi yıllar bu desene girmez.
const AMOUNT_SRC = String.raw`-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b`;
export const AMOUNT_RE = new RegExp(AMOUNT_SRC);
const AMOUNT_RE_GLOBAL = new RegExp(AMOUNT_SRC, "g");

// Bir işlem satırının tutarının makul olarak bulunabileceği en uzak konum.
// Bundan sonra gelen tutarlar artık o işleme ait değil, ardından gelen
// altbilgiye/yasal metne aittir.
const AMOUNT_SCAN_LIMIT = 120;

// Son tutardan SONRA korunacak kuyruk (para birimi, taksit göstergesi,
// ParaPuan kolonu...). Buradan sonrası KESİLİR — reddedilmez.
//
// Neden kesme, reddetme değil: eski kodda TABLE_END_MARKERS tabloyu sayfa
// altbilgisinden önce kesiyordu. O marker'lar (banka-özel oldukları için)
// kaldırıldı, ve ham glyph akışında satır sonu olmadığı için bir sayfanın SON
// işlem satırı, ardından gelen tüm altbilgiyi/yasal metni kendi "satırına"
// yutuyor (sonraki tarihe kadar). Böyle bir satırı uzunluğu yüzünden
// REDDETMEK, her sayfanın son işlemini sessizce kaybetmek olurdu — kesmek
// hem o işlemi koruyor hem altbilgiyi (ve içindeki kimlik bloğunu) atıyor.
const MAX_TAIL_AFTER_AMOUNT = 40;

// Bir özet alanı etiketinin ("Son Ödeme Tarihi:") makul üst sınırı — daha
// uzun bir önek, değerin bir cümlenin içinde geçtiğini gösterir.
const MAX_SUMMARY_LABEL_LENGTH = 48;

// Bankadan bağımsız kimlik bloğu işareti — eski TABLE_END_MARKERS'ın tek
// gerçekten generic üyesi. "TCKN:" ifadesinin göründüğü yer kimlik bloğunun
// başladığı yerdir; hangi banka olursa olsun oradan sonrasını kesmek güvenli.
const IDENTITY_BLOCK_RE = /TCKN\s*:|T\.C\.\s*Kimlik/i;

// Ekstrenin ÜST ÖZET BLOĞU, ham glyph akışında tek bir tarihle başlayan uzun
// bir dizi olarak geliyor ("13/06/2026Dönem Borcu:12.345,67 TLAsgari Ödeme
// Tutarı:4.938,00 TL..." — gerçek bir QNB ekstresinde gözlendi) ve şekil
// testini (tarihle başla + tutar içer) geçiyor. Ayırt edici, bankadan bağımsız
// izi: içinde arka arkaya birden fazla "etiket:değer" yapışması var. Gerçek bir
// işlem açıklamasında bu kalıp ya hiç yok ya da bir kez var (ör. "HTTPS:
// ECOMMERCE.ATVO" — iki nokta rakamla değil harfle devam ettiği için zaten
// sayılmıyor), o yüzden eşik ikiye çekildi.
const LABEL_VALUE_GLUE_RE = /\p{L}\s*:\s*\d/gu;
const MAX_LABEL_VALUE_GLUE = 1;

export type ClassifiedLines = {
  /** Tarihle başlayıp tutar içeren aday işlem satırları, maskelenmiş. */
  transactions: string[];
  /** "kısa etiket + tarih/tutar" şeklindeki özet alanları, maskelenmiş. */
  summary: string[];
};

/**
 * Ham (konumsuz) işlem metnini tarih sınırlarından satırlara böler.
 *
 * extract.ts'in glyph akışı tabanlı metin çıkarıcısı satır sonlarını
 * korumuyor (bkz. oradaki not) — "…16.163,36 TL 15/06/2026 Ödeme…" tek bir
 * düz akış olarak geliyor. Her işlem satırı bir tarihle başladığı için
 * tarihten önce bölmek deterministik ve banka-bağımsız bir satırlaştırma
 * veriyor; eski koddaki `.replace(/(tarih)/g, "\n$1")` hack'inin aynı fikri,
 * ama artık bir hack değil, sınıflandırıcının resmî girdi adımı.
 */
export function splitOnDates(text: string): string[] {
  const fragments = text
    .replace(DATE_RE_GLOBAL, "\n$&")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Bir satırda BİRDEN FAZLA tarih kolonu olabilir (işlem tarihi + valör /
  // banka tarihi — bankaya göre değişen bir düzen). Tarihten önce bölmek bu
  // durumda "12/05/2026" gibi çıplak bir parça üretiyor; onu tutarsız diye
  // ATMAK, ilk tarihi model HİÇ GÖRMEDEN silmek olurdu ve satır sessizce
  // ikinci (valör) tarihe kaymış olurdu. Hangi tarihin işlem tarihi olduğu
  // bankaya göre değişen bir karar, yani tam olarak modele bırakılması
  // gereken şey — o yüzden çıplak tarih parçası atılmıyor, bir SONRAKİ
  // parçanın önüne ekleniyor ve iki tarih birlikte modele gidiyor
  // (prompt kural 7 hangisini seçeceğini söylüyor).
  const merged: string[] = [];
  let pendingDates: string[] = [];
  for (const fragment of fragments) {
    if (BARE_DATE_RE.test(fragment) && pendingDates.length < MAX_LEADING_DATES) {
      pendingDates.push(fragment);
      continue;
    }
    merged.push(pendingDates.length > 0 ? `${pendingDates.join(" ")} ${fragment}` : fragment);
    pendingDates = [];
  }
  // Sonda kalan çıplak tarih(ler) bir işlem satırı oluşturamaz (tutar yok) —
  // eskiden olduğu gibi düşerler.
  return merged;
}

/**
 * Bir aday satırı işlem satırına normalize eder — işlem satırı gibi
 * durmuyorsa null, duruyorsa tutardan sonrası kırpılmış hali.
 *
 * Kriter: tarihle başlamalı ve makul bir konumda (AMOUNT_SCAN_LIMIT) bir
 * tutar içermeli. İkisi de bankadan bağımsız.
 */
export function normalizeTransactionLine(line: string): string | null {
  if (!LEADING_DATE_RE.test(line)) return null;

  let lastAmountEnd = -1;
  for (const match of line.matchAll(AMOUNT_RE_GLOBAL)) {
    if (match.index > AMOUNT_SCAN_LIMIT) break;
    lastAmountEnd = match.index + match[0].length;
  }
  if (lastAmountEnd === -1) return null;

  const trimmed = line.slice(0, lastAmountEnd + MAX_TAIL_AFTER_AMOUNT).trim();
  // Kırpmadan SONRA hâlâ bir kimlik bloğu işareti kaldıysa bu satır bir işlem
  // satırı değil — tamamen at.
  if (IDENTITY_BLOCK_RE.test(trimmed)) return null;
  if ((trimmed.match(LABEL_VALUE_GLUE_RE) ?? []).length > MAX_LABEL_VALUE_GLUE) return null;
  return trimmed;
}

function nextSummaryValue(text: string): RegExpExecArray | null {
  return (
    [DATE_RE, WRITTEN_DATE_RE, AMOUNT_RE]
      .map((re) => re.exec(text))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => a.index - b.index)[0] ?? null
  );
}

// Bir değerin ÖNÜNDEKİ metinden o değere ait etiketi ayıklar.
//
// Etiket, satır başından değil, değerin hemen SOLUNDAKİ kesintisiz "rakamsız
// ve maskesiz" koşudan oluşur. Sebep, gerçek bir QNB ekstresinde bulunan bir
// gizlilik hatası: ekstrenin üst bloğu iki kolonlu, dolayısıyla y'ye göre
// kurulan bir satır iki ayrı alanı birden taşıyabiliyor —
// "Kredi Kartı Numarası : [KART] Son Ödeme Tarihi: 23 Haziran 2026". Etiketi
// satır başından almak burada iki hataya yol açıyordu: (a) etiket rakam
// içerdiği için alan tamamen düşüyor ve son ödeme tarihi kayboluyordu,
// (b) sıranın tersi olduğunda ("Sn. AD SOYAD Son Ödeme Tarihi: ...") komşu
// kolondaki ad etiketin içinde LLM'e gidiyordu.
//
// Neden x koordinatına göre kolon ayırmak değil: gerçek PDF üzerinde ölçüldü —
// bu ekstrede etiket→değer boşlukları (47-91 birim) ile kolon→kolon
// boşlukları (64 birim) aynı aralığa düşüyor, tek bir eşik ikisini
// ayıramıyor. Rakam/maske sınırı ise kolon geçişini güvenilir biçimde
// yakalıyor: komşu kolonun içeriği ya rakam taşıyor (kart no, müşteri no,
// posta kodu) ya da maskeleyici tarafından zaten bir etikete çevrilmiş.
function labelBefore(before: string): string | null {
  const lastBoundary = Math.max(
    ...[...before.matchAll(/\d|\[(?:TCKN|KART|IBAN|TELEFON|EPOSTA|AD|NO)\]/g)].map(
      (m) => m.index + m[0].length,
    ),
    0,
  );
  // Baştaki noktalama/boşluk atılır: bir önceki alanın değeri tüketildikten
  // sonra kalan parça sıklıkla ", " ile başlıyor.
  const label = before.slice(lastBoundary).replace(/^[\s,;:|/*-]+/, "").trim();
  if (label.length === 0 || label.length > MAX_SUMMARY_LABEL_LENGTH) return null;
  // En az iki harf — ": " ya da "•" gibi tek işaretlik önekleri ele.
  return (label.match(/\p{L}/gu) ?? []).length >= 2 ? label : null;
}

/**
 * Bir satırdaki "etiket + değer" biçimli özet alanlarını ayıklar. Değer bir
 * tarih (sayısal ya da yazıyla) veya bir tutar olmalı; önündeki etiket kısa ve
 * rakamsız olmalı.
 *
 * Bu, ekstre kesim/son ödeme tarihini bulmak için gereken TEK mekanizma —
 * hangi etiketin ne anlama geldiğine LLM karar veriyor, bizim banka başına
 * etiket listesi tutmamıza gerek kalmıyor.
 *
 * Satır BAŞINA BİR alan değil, ARDIŞIK ALANLAR ayıklanır ve her alan kendi
 * değerinden SONRA kesilir. Sebep bir gizlilik hatası: layout.ts satırları
 * y koordinatına göre kuruyor, ekstrenin üst bloğu ise iki KOLONLU —
 * solda özet alanları, sağda ad/adres. Aynı görsel satır bu yüzden ikisini
 * birden taşıyor ve tek-alan mantığı adı/adresi kuyrukta LLM'e taşıyordu
 * (gerçek bir QNB ekstresinde doğrulandı: "Asgari Ödeme Oranı : TL %40.00 Sn.
 * AD SOYAD" ve "Kredi Kartı Limiti : 99.999,00 TL [adres]"). Değerden sonrası
 * kesilince ad/adres yapısal olarak düşüyor: geri kalan parça geçerli bir
 * "etiket + değer" çifti oluşturmadığı için hiç emit edilmiyor.
 *
 * Aynı mantık tersini de kurtarıyor: kesim ve son ödeme tarihini tek bir
 * görsel satırda yan yana yazan bir banka düzeninde (kolonlar) ikisi de
 * ayrı ayrı ayıklanır — tek-alan mantığı ikincisini kaybediyordu.
 *
 * Girdinin ZATEN maskelenmiş olması beklenir (bkz. classifyLines): etiket
 * sınırı maske etiketlerine dayanıyor.
 */
export function extractSummaryFields(maskedLine: string): string[] {
  if (LEADING_DATE_RE.test(maskedLine)) return []; // işlem satırı, özet değil

  // Kimlik bloğu işaretinden SONRASI tamamen atılır (satırın tümü
  // reddedilmez): QNB'de "Son Ödeme Tarihi: 23 Haziran 2026, Salı" ile
  // sağdaki "TCKN : ..." bloğu aynı görsel satıra düşüyor, satırı bütünüyle
  // reddetmek son ödeme tarihini de kaybettiriyordu.
  const identity = IDENTITY_BLOCK_RE.exec(maskedLine);
  let rest = identity ? maskedLine.slice(0, identity.index) : maskedLine;

  const fields: string[] = [];
  while (rest.length > 0) {
    const value = nextSummaryValue(rest);
    if (!value) break;
    const label = labelBefore(rest.slice(0, value.index));
    if (label !== null) fields.push(`${label} ${value[0]}`.replace(/\s+/g, " ").trim());
    rest = rest.slice(value.index + value[0].length);
  }
  return fields;
}

/**
 * Aday satırları iki kovaya ayırır ve HER İKİSİNİ maskeleyiciden geçirir.
 *
 * Özet kovasında maskeleyici bir şey yakaladıysa satır tamamen atılır: bir
 * özet alanının kart numarasına/TCKN'ye ihtiyacı yok, dolayısıyla o satır
 * ya bir kimlik satırıdır ya da şüphelidir — ikisinde de LLM'e gitmemesi
 * doğru. İşlem kovasında ise satır KORUNUR (maskeli haliyle): merchant
 * açıklamasında Luhn'dan geçen uzun bir referans numarası olabilir, o
 * satırın tutarı/tarihi hâlâ geçerli veri.
 */
export function classifyLines(params: {
  transactionCandidates: string[];
  summaryCandidates: string[];
}): ClassifiedLines {
  const transactions: string[] = [];
  for (const line of params.transactionCandidates) {
    const normalized = normalizeTransactionLine(line);
    if (normalized === null) continue;
    transactions.push(maskPersonalData(normalized));
  }

  // Maskeleme ALAN AYIKLAMADAN ÖNCE yapılıyor: maske etiketleri
  // ("[KART]", "[AD]") extractSummaryFields için kolon sınırı işlevi görüyor,
  // yani maskeleyici burada yalnızca bir savunma katmanı değil, komşu
  // kolonun etikete karışmasını engelleyen yapısal sınır (bkz. labelBefore).
  const summary: string[] = [];
  const seen = new Set<string>();
  for (const line of params.summaryCandidates) {
    for (const field of extractSummaryFields(maskPersonalData(line))) {
      // Etiketler maske sınırından sonra başladığı, değerler ise tarih/tutar
      // olduğu için buraya bir maske etiketi kalmamalı — kalıyorsa varsayım
      // bozulmuş demektir, o alanı LLM'e göndermiyoruz.
      if (MASK_MARKER_RE.test(field)) continue;
      // Aynı özet alanı her sayfanın üstünde tekrar edebiliyor — LLM'e aynı
      // satırı onlarca kez göndermenin faydası yok.
      if (seen.has(field)) continue;
      seen.add(field);
      summary.push(field);
    }
  }

  return { transactions, summary };
}
