// Deterministik PII maskeleyici — banka bilgisi SIFIR, sadece evrensel
// biçimlere bakar (checksum'lı kimlik numaraları, Luhn'lu kart numaraları,
// IBAN, telefon, e-posta).
//
// Bu dosya bir güvenlik sınırı DEĞİL, ikinci katmandır. Asıl garanti hâlâ
// classify.ts'teki şekil temelli whitelist: LLM'e yalnızca "tarihle başlayıp
// tutarla biten" işlem satırları ve "kısa etiket + tarih/tutar" özet
// satırları çıkar; ad/adres/imza blokları hiç emit edilmez (bkz.
// extract.ts'in dosya başı notu). Maskeleyici, o whitelist'ten sızabilecek
// tek şeye (ör. "Sayın AD SOYAD, son ödeme tarihiniz 25/05/2026" gibi
// içinde tarih GEÇEN bir hitap satırı) karşı savunma derinliğidir.
//
// Kasıtlı olarak yapılmayan şey: BÜYÜK HARF bloklarını "isim olabilir" diye
// maskelemek. Türk ekstrelerinde merchant adları da büyük harf yazılıyor
// ("MIGROS ATASEHIR", "KAĞAN OTOMOTIV") — bu kural işlem verisinin yarısını
// yok ederdi. Ad/adres'e karşı korunma maskelemeden değil, o satırların
// hiç emit edilmemesinden geliyor.

const MASK_TCKN = "[TCKN]";
const MASK_CARD = "[KART]";
const MASK_IBAN = "[IBAN]";
const MASK_PHONE = "[TELEFON]";
const MASK_EMAIL = "[EPOSTA]";
const MASK_NAME = "[AD]";
const MASK_NUMBER = "[NO]";

// Maskeleyicinin ürettiği tüm etiketler — özet satırı whitelist'i, içinde
// maskelenmiş bir alan KALAN satırı tamamen atmak için bunu kullanıyor
// (bir özet alanının kart numarasına ihtiyacı yok; şüpheliyse satırı at).
export const MASK_MARKER_RE = /\[(?:TCKN|KART|IBAN|TELEFON|EPOSTA|AD|NO)\]/;

// T.C. Kimlik Numarası resmî checksum'ı. Salt "11 hane" kuralı bir referans
// numarasını da yakalardı; checksum yanlış pozitifi ~1/100'e indiriyor (ve
// yanlış pozitif zararsız: maskelenen şey yine bir numara, tutar/tarih değil).
function isValidTckn(digits: string): boolean {
  if (digits.length !== 11 || digits[0] === "0") return false;
  const d = [...digits].map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  if ((oddSum * 7 - evenSum) % 10 !== d[9]) return false;
  const firstTen = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return firstTen % 10 === d[10];
}

// Kredi kartı numarası Luhn kontrolü — 13-19 hanelik her rakam dizisi değil,
// yalnızca Luhn'dan geçenler maskelenir. Para tutarları ("1.234,56") noktalama
// içerdiği için bu desene hiç girmiyor, tarihler de ("05/07/2026") öyle —
// yani maskeleyici tutar/tarih span'lerine yapısal olarak dokunamıyor.
function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// Bankaların ekstrede zaten maskeleyerek yazdığı kart numarası biçimi
// ("5218 45** **** 1234") — Luhn'dan geçmez (yıldızlar yüzünden), o yüzden
// ayrı bir desen gerekiyor. Yıldız sayısı/gruplama bankaya göre değişebildiği
// için gruplar gevşek tanımlı.
const MASKED_PAN_RE = /\b\d{4}[\s-]?\d{0,2}\*{2,}[\s*-]*\d{4}\b/g;

// IBAN: TR + 2 kontrol hanesi + 22 hane (boşluklu ya da boşluksuz yazılabilir).
const IBAN_RE = /\bTR\s?\d{2}(?:\s?\d){22}\b/gi;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g;

// Türkiye telefon biçimleri: +90/0 önekli 10 hane, gruplama serbest.
// Bankanın kendi çağrı merkezi numarası da (0850 222 0 900) maskelenir —
// PII değil ama LLM'e gitmesinin de bir faydası yok, zararsız kayıp.
const PHONE_RE = /(?:\+90|\b0)[\s(]?\d{3}[\s)]?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;

// Etiketli numara alanları — checksum/Luhn'dan geçmeyen ama açıkça kimlik
// taşıyan alanlar ("Müşteri Numarası: 12345678"). Etiket korunur, değer
// maskelenir; LLM etiketin ne olduğunu görsün ama değerini görmesin.
const LABELED_ID_RE =
  /((?:Müşteri|Musteri|Hesap|Sicil|Kart|Vergi|TCKN|T\.C\.)\s*(?:Kimlik\s*)?(?:No|Numaras[ıi])?\s*:?\s*)([\d][\d\s*-]{3,})/gi;

// "Sayın AD SOYAD" / "Sn. AD SOYAD" — hitap satırı, özet satırı
// whitelist'inden geçebilecek tek isim taşıyıcısı. Virgül/nokta/satır sonuna
// kadar olan kısım maskelenir.
//
// "Sn." kısaltması gerçek bir QNB ekstresinde bulundu: ekstrenin üst bloğu iki
// kolonlu ve sağ kolondaki "Sn. AD SOYAD" hitabı, sol kolondaki özet alanıyla
// aynı görsel satıra düşüyor (bkz. classify.ts'teki extractSummaryFields
// notu). Bu bir bankaya değil, Türkçe yazışma diline ait bir kalıp — banka
// başına konfigürasyon sayılmıyor.
const SAYIN_RE = /\b(Say[ıi]n|Sn\.?)\s+[^\n,.:;]{2,60}/gi;

/**
 * Verilen metindeki evrensel biçimli kişisel verileri etiketlerle değiştirir.
 * Tarih ve para tutarı span'lerine hiçbir desen dokunmaz (yukarıdaki
 * notlara bakınız) — içe aktarmanın finansal doğruluğu maskelemeden
 * etkilenmez.
 */
export function maskPersonalData(text: string): string {
  return text
    .replace(EMAIL_RE, MASK_EMAIL)
    .replace(IBAN_RE, MASK_IBAN)
    .replace(MASKED_PAN_RE, MASK_CARD)
    .replace(SAYIN_RE, (_m, label: string) => `${label} ${MASK_NAME}`)
    .replace(LABELED_ID_RE, (_m, label: string) => `${label}${MASK_NUMBER}`)
    .replace(PHONE_RE, MASK_PHONE)
    .replace(/\b\d{11,19}\b/g, (digits) => {
      if (digits.length === 11) return isValidTckn(digits) ? MASK_TCKN : digits;
      if (digits.length >= 13) return isLuhnValid(digits) ? MASK_CARD : digits;
      return digits;
    });
}
