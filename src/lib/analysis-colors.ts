// Kategori -> sabit renk slotu eşlemesi.
//
// TASARIM KARARI VE NEDENİ (iki kez yanlış yapıldı, üçüncüde oturdu):
//
// 1. İlk hâl: bar listelerinin hepsi tek turuncu. Kullanıcı: "tüm renkler
//    turuncu, bu güzel değil."
// 2. İkinci hâl: sıraya göre 5 tonluk turuncu rampa. Daha kötüydü — ekranda
//    birbirine yakın onlarca turuncu birikti ("çok fazla aynı renk veya
//    benzer tonda renk olması rahatsız edici") VE rehberin pazarlıksız
//    kuralını ihlal ediyordu: "color follows the entity, never its rank."
//    Rampa sıraya bağlı olduğu için market bu ay birinciyse koyu, ertesi ay
//    ikinciyse başka renk oluyordu; yani renk hiçbir şey taşımıyordu
//    (büyüklüğü zaten barın boyu söylüyor).
// 3. Üçüncü hâl (bu dosya): renk KATEGORİYE sabit bağlı. Market her zaman
//    aynı renk. Hem kural sağlanıyor hem sayfa gerçekten renkli oluyor —
//    tek hue'nun tonları yerine 8 ayrı hue.
//
// Neden tam 8: ENTRY_CATEGORIES'in 10 üyesinden ikisi (maaş, serbest) gelir
// kategorisi, harcama kırılımında hiç görünmüyor. Kalan tam 8 harcama
// kategorisi, doğrulanmış 8 slota birebir oturuyor. Rehberin seri tavanı da
// 8 ve 9. bir hue ÜRETMEK yasak — kullanıcının kendi eklediği kategoriler bu
// yüzden nötre düşüyor, yeni renk uydurulmuyor.
//
// Slot atamaları KEYFİ AMA SABİT: hangi kategorinin hangi slotu aldığı
// görsel bir tercih, ama bir kez seçildikten sonra değişmemeli — değişirse
// kullanıcının aylar arası kurduğu renk hafızası bozulur.

const CATEGORY_SLOTS: Record<string, number> = {
  market: 1,
  yemek: 2,
  kira: 3,
  ulaşım: 4,
  eğlence: 5,
  fatura: 6,
  abonelik: 7,
  diğer: 8,
};

/** Kategori paleti dışında kalanlar (kullanıcının kendi kategorileri) için. */
export const NEUTRAL_BAR_CLASS = "bg-foreground/25";

/**
 * Bir kategorinin CSS rengi. Palette girmeyen kategoriler için null döner —
 * çağıran taraf nötre düşer (9. bir hue üretmek yasak).
 */
export function categoryColor(category: string | null): string | null {
  const slot = CATEGORY_SLOTS[category ?? "diğer"];
  return slot ? `var(--viz-cat-${slot})` : null;
}
