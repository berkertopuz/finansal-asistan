// EBCDIC metin katmanı çözücüsü — anabilgisayarda (AFP) üretilip PDF'e
// sarılmış ekstreler için.
//
// SORUN: Bazı bankalar (doğrulanan örnek: Akbank Axess, producer
// "CrawfordTech PDF Driver") ekstreyi IBM anabilgisayarında üretip AFP'den
// PDF'e çeviriyor. Ortaya çıkan PDF'te:
//   - Tüm fontlar **Type3** (glyph'ler vektör çizimi, gömülü font programı
//     yok, incelenecek bir cmap yok),
//   - **`/ToUnicode` CMap YOK** (dosyanın tamamı açılıp arandı: 0 adet),
//   - `/Encoding /Differences` var ama glyph adları `/C40`, `/Cc1`, `/Cec`
//     — yani "C" + kodun onaltılığı. Kendi kendine atıf yapan, hiçbir
//     anlam taşımayan adlar (`/Aacute` ya da `/uni00C1` gibi çözülebilir
//     standart adlar DEĞİL).
//
// Yani kod→karakter eşleşmesi dosyada gerçekten YOK. Bu bir pdf.js eksiği
// değil: aynı PDF poppler'ın `pdftotext`'iyle de denendi, o daha da kötüsünü
// yaptı (rakamları tamamen kaybetti; pdf.js en azından ham kodu Latin-1
// olarak koruyor). Başka bir PDF kütüphanesine geçmek bu dosyayı ÇÖZMEZ —
// çözümü kendimiz koymak zorundayız.
//
// ÇÖZÜM: Kodlar EBCDIC. QNB'nin kırık fontundan (bkz. extract.ts) kritik
// farkı, oradaki eşleşmenin her belgede yeniden rastgele numaralanması,
// buradakinin ise SABİT ve yayımlanmış bir kod sayfası olması — belge başına
// kalibrasyon gerekmiyor, tek bir tablo her ekstrede çalışıyor.
//
// KAPSAM — neden yalnızca "invariant" alt küme:
// Belgede birden çok Type3 font var ve Türkçe'ye özgü harfler her fontta
// FARKLI koda düşüyor (gerçek Axess ekstresinde doğrulandı: 0xCC bir fontta
// "ö" — "Dönem" —, başka bir fontta "Ş" — "SATIŞ" —). Yani Türkçe bandı için
// tek bir global tablo YANLIŞ olurdu. Buna karşılık aşağıdaki alt küme —
// A-Z, a-z, 0-9, boşluk ve tarih/tutar noktalaması — TÜM EBCDIC kod
// sayfalarında aynıdır ve belgedeki bütün fontlarda tutarlı çıkıyor.
//
// Bu tam olarak yeterli, çünkü şekil temelli whitelist'in (classify.ts)
// dayandığı her şey bu bantta: tarih rakamları, tutar rakamları, binlik/ondalık
// ayırıcı ve tarih ayırıcısı. Çözülemeyen Türkçe harfler yalnızca merchant
// adında bir karaktere düşüyor ("SARIO?LU B?FE") — LLM bunları bağlamdan
// zaten büyük ölçüde geri getiriyor, ve getiremese bile tutar/tarih doğru.
const EBCDIC_TO_ASCII: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  const run = (start: number, letters: string) => {
    [...letters].forEach((ch, i) => {
      map[start + i] = ch;
    });
  };
  // EBCDIC'te harfler üç kesintili blok halinde durur (A-I, J-R, S-Z).
  run(0xc1, "ABCDEFGHI");
  run(0xd1, "JKLMNOPQR");
  run(0xe2, "STUVWXYZ");
  run(0x81, "abcdefghi");
  run(0x91, "jklmnopqr");
  run(0xa2, "stuvwxyz");
  run(0xf0, "0123456789");
  map[0x40] = " ";
  // 0x20 EBCDIC'te bir kontrol karakteri, gerçek metinde asla geçmez —
  // buradaki tek kaynağı layout.ts'in kolonlar arasına KENDİ eklediği ASCII
  // boşluk. Çözülemedi sayıp "?" yazmak, ayıklanan her özet etiketinin
  // içine sahte bir karakter serpiyordu ("D?nem ?Borcu?").
  map[0x20] = " ";
  map[0x4b] = ".";
  map[0x6b] = ",";
  map[0x61] = "/";
  map[0x60] = "-";
  map[0x7a] = ":";
  map[0x5e] = ";";
  map[0x4d] = "(";
  map[0x5d] = ")";
  map[0x4e] = "+";
  map[0x50] = "&";
  map[0x5c] = "*";
  map[0x6c] = "%";
  map[0x7e] = "=";
  map[0x7d] = "'";
  map[0x6f] = "?";
  map[0x5a] = "!";
  return map;
})();

// Çözülemeyen kod için ne yazılacağı. Boş bırakmak (QNB davranışı) burada
// yanlış olurdu: orada eksik glyph seyrek bir istisnaydı, burada TÜM Türkçe
// harfler bu duruma düşüyor ve harfi tamamen silmek "SARIOĞLU" -> "SARILU"
// gibi LLM'in de kurtaramayacağı bir kelime bırakırdı. Yerine bir yer tutucu
// koymak hem kelimenin şeklini hem harf sayısını koruyor.
const UNKNOWN_CHAR = "?";

// EBCDIC'te ASCII rakamları (0x30-0x39) hiç kullanılmaz; rakamlar 0xF0-0xF9'da
// durur. Bir ekstrede tarih ve tutar her zaman bol miktarda rakam demek, yani
// "ASCII rakam yok ama yüksek bantta bol rakam var" ayrımı hem güçlü hem de
// yanlış pozitif üretmesi zor: normal (Latin-1 çıkan) bir PDF'te 0xF0-0xF9
// bandı "ð ñ ò ..." demektir ve gerçek metinde bu yoğunlukta bulunmaz.
const MIN_EBCDIC_DIGITS = 20;

export function looksLikeEbcdic(text: string): boolean {
  let asciiDigits = 0;
  let ebcdicDigits = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x30 && c <= 0x39) asciiDigits++;
    else if (c >= 0xf0 && c <= 0xf9) ebcdicDigits++;
  }
  return ebcdicDigits >= MIN_EBCDIC_DIGITS && ebcdicDigits > asciiDigits * 4;
}

/**
 * pdf.js'in Latin-1'e düşerek verdiği ham EBCDIC kodlarını okunabilir metne
 * çevirir. Satır sonları ve 0xFF üstü karakterler (varsa) olduğu gibi kalır.
 */
export function decodeEbcdic(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\r") out += ch;
    else if (c > 0xff) out += ch;
    else out += EBCDIC_TO_ASCII[c] ?? UNKNOWN_CHAR;
  }
  return out;
}
