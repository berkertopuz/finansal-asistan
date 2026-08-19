import { z } from "npm:zod@^4";

// Sesli giriş taslağı. Alan adları KASITLI olarak İngilizce ve
// src/lib/actions/entries.ts'teki form alanlarıyla birebir aynı — statements/
// modülü Türkçe alan adları kullanıp Next tarafında eşliyor, ama orada buna
// mecburiyet vardı (ekstre kavramları "odeme"/"ucret" entry kind'larına 1:1
// karşılık gelmiyor). Burada karşılık birebir olduğu için araya bir eşleme
// katmanı koymak sadece hata yüzeyi olurdu.

export const VOICE_KINDS = ["income", "expense", "subscription"] as const;
export const VOICE_RECURRENCES = ["none", "weekly", "monthly", "yearly"] as const;

// TCMB'nin yayımladığı para birimleri (src/lib/providers/tcmb-fx.ts ile elle
// senkron — iki runtime, ortak paket yok). Model bu listenin dışına çıkamıyor.
export const VOICE_CURRENCIES = [
  "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK",
  "SAR", "AED", "KWD", "QAR", "RON", "RUB", "CNY", "PKR", "KRW", "AZN", "KZT",
] as const;

// TEK İŞLEM DEĞİL, LİSTE. İlk sürüm tek bir işlem döndürüyordu ve gerçek
// kullanımda hemen kırıldı: "100 lira sigara, 50 lira ekmek, 15 lira su"
// dendiğinde model üç işlemi tek bir nesneye sığdıramayıp şemayı ihlal etti
// (kullanıcıya "yapay zekâ servisine ulaşılamadı" olarak yansıdı). Şema tek
// nesneye kilitli kaldığı sürece en iyi ihtimalle iki işlem SESSİZCE
// düşecekti — ki bu hatadan da kötü. İnsanlar harcamalarını tek tek değil,
// hatırladıkları gibi topluca sayıyor; doğru birim bu.
export const voiceItemSchema = z.object({
  kind: z.enum(VOICE_KINDS),
  // Her zaman pozitif — işaret kind'dan türer (DB'de CHECK amount > 0).
  amount: z.number().nullable(),
  // Duyulan para biriminin ISO kodu ("TRY", "EUR", "USD"…). Önceden yalnızca
  // "TRY" | "foreign" idi ve hangi döviz olduğu kayboluyordu; artık kod
  // taşındığı için form o para birimini seçili açıp o günün TCMB kurunu
  // çekebiliyor. Çevirmeyi model YAPMIYOR (CLAUDE.md kural 5) — sadece ne
  // duyduğunu söylüyor, kuru sunucu getiriyor.
  currency: z.string(),
  category: z.string(),
  description: z.string(),
  occurred_at: z.string().nullable(), // YYYY-MM-DD
  recurrence: z.enum(VOICE_RECURRENCES),
  installmentCount: z.number().nullable(),
  // Kullanıcının söylediği kartın ADI, yoksa null (= nakit/banka). Kullanıcı
  // "gofret 80 tl kredi kartı" diyebiliyor ve bu bilginin gidecek bir yeri
  // yoktu — hem kayboluyordu hem de modeli şemada karşılığı olmayan bir
  // kavramı yerleştirmeye çalışırken fazladan düşünmeye itiyordu (bkz.
  // gemini-client.ts'teki MAX_TOKENS notu). Kart adı listesi kategoriler gibi
  // istek anında enjekte ediliyor; kullanıcı kart adı vermeden sadece "kredi
  // kartı" derse ve TEK kartı varsa model onu seçer, birden fazlaysa null
  // bırakır ve kullanıcı inceleme listesinden seçer.
  creditCardName: z.string().nullable(),
});

export const voiceResponseSchema = z.object({
  // Modelin kayıtta DUYDUĞU cümlenin düz metni. İki işi birden görüyor:
  //
  // 1) TEŞHİS: kullanıcı "1700 dedim ama 1100 yazmış" dediğinde, transkript
  //    "bin yüz" diyorsa sorun DUYMA (model sesi yanlış anladı), "bin yedi
  //    yüz" diyorsa sorun ÇIKARIM (duydu ama alana yanlış yazdı). Bu ikisinin
  //    çaresi tamamen farklı ve transkript olmadan ayırt edilemiyor.
  // 2) DOĞRULUK: propertyOrdering'de items'tan ÖNCE geliyor, yani model önce
  //    ne duyduğunu yazıyor sonra ondan çıkarım yapıyor. Çıkarımı açık bir
  //    transkripte dayandırmak, tek adımda "dinle + alanları doldur"dan daha
  //    isabetli — özellikle sayılarda.
  transcript: z.string(),
  // Kayıttan hiçbir işlem çıkarılamadıysa (sessiz kayıt, alakasız konuşma,
  // içinde tutar geçmeyen cümle) false ve items boş. Uydurma bir tutarla
  // form doldurmak en kötü sonuç olurdu.
  understood: z.boolean(),
  items: z.array(voiceItemSchema),
});

export type VoiceItem = z.infer<typeof voiceItemSchema>;
export type VoiceResponse = z.infer<typeof voiceResponseSchema>;

// Gemini'nin responseSchema'sı (OpenAPI alt kümesi). responseMimeType tek
// başına yalnızca "JSON olsun" der; alan adlarını ve enum'ları asıl garanti
// eden şey bu şema. Kategori listesi kullanıcıya özel (preset + kendi
// etiketleri) olduğu için şema istek anında kuruluyor, sabit değil.
export function buildVoiceResponseSchema(
  categories: readonly string[],
  cardNames: readonly string[],
) {
  const itemProperties = {
    kind: { type: "STRING", enum: [...VOICE_KINDS] },
    amount: { type: "NUMBER", nullable: true },
    currency: { type: "STRING", enum: ["TRY", ...VOICE_CURRENCIES] },
    category: { type: "STRING", enum: [...categories] },
    description: { type: "STRING" },
    occurred_at: { type: "STRING", nullable: true },
    recurrence: { type: "STRING", enum: [...VOICE_RECURRENCES] },
    installmentCount: { type: "INTEGER", nullable: true },
    // Kartı olmayan kullanıcıda enum boş kalamaz (Gemini boş enum'u
    // reddediyor) — o durumda serbest string, Next tarafı zaten tanımadığı
    // her adı null'a düşürüyor.
    creditCardName:
      cardNames.length > 0
        ? { type: "STRING", enum: [...cardNames], nullable: true }
        : { type: "STRING", nullable: true },
  };
  const itemKeys = Object.keys(itemProperties);

  return {
    type: "OBJECT",
    properties: {
      // SIRA ÖNEMLİ: transcript önce üretiliyor (propertyOrdering), items
      // ondan sonra — bkz. voiceResponseSchema'daki not.
      transcript: { type: "STRING" },
      understood: { type: "BOOLEAN" },
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: itemProperties,
          required: itemKeys,
          propertyOrdering: itemKeys,
        },
      },
    },
    required: ["transcript", "understood", "items"],
    propertyOrdering: ["transcript", "understood", "items"],
  };
}
