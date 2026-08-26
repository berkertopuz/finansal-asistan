// Giriş/kayıt sonrası nereye dönüleceği. Davet linkine oturumsuz tıklayan
// kişi giriş yaptıktan sonra linke geri dönmek zorunda — aksi halde token
// kayboluyor ve kullanıcıya "linki tekrar aç" demek gerekiyordu.

// Kullanıcıdan (URL'den) gelen bir yönlendirme hedefi DÜŞMANDIR: doğrulanmadan
// redirect()'e verilirse açık yönlendirme (open redirect) olur — saldırgan
// /giris?next=https://sahte-site linkini paylaşıp kullanıcıyı giriş sonrası
// kendi kopya sayfasına düşürebilir. Bu yüzden yalnızca uygulama içi mutlak
// yollar geçiyor:
//   - "//evil.com" ve "/\evil.com" protokol-görelidir, tarayıcı bunları DIŞ
//     adres olarak çözer — tek eğik çizgiyle başlıyor diye güvenli değiller.
//   - Ters bölü ve kontrol karakterleri (CR/LF dahil) header enjeksiyonuna
//     alan açıyor.
const MAX_NEXT_LENGTH = 512;
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || value.length > MAX_NEXT_LENGTH) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (UNSAFE_CHARS.test(value)) return fallback;
  return value;
}

// Bir auth sayfasına "geri dön" hedefini taşıyan link üretir. Hedef
// varsayılan ("/") ise parametre hiç eklenmiyor — temiz URL.
export function withNextParam(path: string, next: string | undefined): string {
  const safe = safeNextPath(next);
  return safe === "/" ? path : `${path}?next=${encodeURIComponent(safe)}`;
}
