@AGENTS.md

# Finansal Asistan — Proje Brief (Claude Code için)

Kişisel kullanım için Türkçe bir PWA: nakit akışı defteri + haber tetiklemeli yatırım sinyal motoru (BIST, altın, kripto, döviz). Next.js App Router + TypeScript + Tailwind + Supabase + GPT-4o.

## Kesin kurallar (pazarlıksız)

1. **Dil:** Uygulama çok dilli — varsayılan Türkçe, İngilizce de desteklenir (next-intl, `profiles.locale` kullanıcı tercihini taşır). Statik UI metinleri (menü, buton, form, hata mesajı, sabit yasal metinler) mesaj kataloğundan (`messages/tr.json`, `messages/en.json`) gelir. LLM promptlarının kendi iç talimatları (kural seti, JSON şema, prompt injection guard) Türkçe sabit kalır, ama üretilen öneri metni doğrudan kullanıcının seçili dilinde yazdırılır (aynı anda iki dilde üretilmez). Kod yorumları İngilizce olabilir.
2. **Yasal:** Her öneri yüzeyinin EN ÜSTÜNDE, sunucu tarafında statik olarak şu metin basılır (LLM'e bırakılmaz): "Bu öneriler yalnızca bilgilendirme amaçlıdır; yatırım tavsiyesi niteliği taşımaz. SPK lisanslı bir danışmana başvurunuz."
3. **Auth:** Geçerli oturum olmadan hiçbir finansal veri render edilmez. Supabase Auth (email/şifre + Google OAuth). Tüm kullanıcı tablolarında RLS: `auth.uid() = user_id`.
4. **Arayüz:** shadcn/ui bileşen kütüphanesiyle hem mobil hem masaüstü için modern, responsive tasarım — masaüstü mobilin küçültülmüş hali değil, ayrı düşünülmüş bir layout (örn. mobilde alt tab bar, masaüstünde sol sidebar nav). Mobil: 375px viewport, dokunma hedefleri ≥ 48px, yatay scroll yok, Lighthouse mobil ≥ 90. Gelir/gider ekleme ana ekrandan ≤ 3 dokunuş.
5. **Fiyat uydurma yasak:** LLM bağlamına giren her fiyat aynı istek döngüsünde canlı API'den gelir. API düşerse o varlık sınıfı için "Veri alınamadı — öneri ertelendi" gösterilir; bayat/uydurma veri asla.
6. **Tazelik:** Nitelikli olay (BIST-100 ±%2, USD/TRY ±%1.5, faiz kararı, TÜFE) sonrası 24 saat içinde pozisyon sinyalleri yenilenir. Haftada ≥ 5 yeni alım önerisi.

## Onaylanmış mimari kararlar

- **BIST verisi:** Investing.com kazıma YAPMA (T4). Yahoo Finance chart API (`.IS` ticker'ları, örn. `XU100.IS`) — resmi olmayan ama scraping değil, JSON endpoint (T3). `supabase/functions/_shared/providers/` altında değiştirilebilir adaptör (`bist.ts`). Gecikme UI'da açıkça gösterilir.
- **Altın:** Ayrı bir altın API'si yok — Binance'in PAXGUSDT paritesi (1 PAXG ≈ 1 ons altın) + USDT/TRY çapraz kuru üzerinden gram altın TRY türetiliyor (`binance.ts`, T3 — PAXG spota göre küçük prim/iskontolu işlem görebilir).
- **Haberler:** NewsAPI değil, Türk RSS beyaz listesi: AA, Bloomberg HT, Dünya, NTV Ekonomi. (Reuters TR listedeydi ama Reuters artık genel erişime açık RSS sunmuyor — 2026-07-18'de doğrulanıp NTV Ekonomi ile değiştirildi.) `fast-xml-parser` ile parse.
- **Cron:** Vercel Cron değil, Supabase pg_cron + Edge Functions. Cron→function auth: özel bir secret değil, platformun kendi `apikey`/secret-key mekanizması (`@supabase/server`'ın `withSupabase({auth:["secret"]})` deseni) — Vault'ta `edge_function_secret_key` adıyla saklanan gerçek Supabase secret key'i gönderilir.
- **Kripto:** Binance public API (`/api/v3/ticker/price`). **Döviz:** TCMB `today.xml` (günlük) + Binance USDT/TRY cross-rate fallback (fallback kullanılınca güven en fazla "orta").
- **Nakit akışı zaman çizelgesi faiz varsayımı:** TCMB EVDS API, seri `TP.TRY.MT01` (bankaların 1 ay vadeli TL mevduata uyguladığı ağırlıklı ortalama faiz, haftalık/Cuma günü yayımlanır) — `https://evds3.tcmb.gov.tr/igmevdsms-dis/series=...`, kimlik doğrulama URL parametresi değil HTTP `key` header'ı (EVDS 2024'te değiştirdi). `src/lib/providers/evds.ts`, Next'in `fetch` cache'i ile 12 saat revalidate (istatistik zaten haftada bir değişiyor, ayrı bir cron/market_snapshots gerekmiyor). Başarısız olursa `null` döner, çağıran taraf `profiles.assumed_annual_rate`'e düşer — asla uydurma sayı yok.
- **UI kütüphanesi:** shadcn/ui (`base-nova` preset, Base UI primitives, Tailwind v4). Bileşenler `src/components/ui/` altında proje sahipliğinde — gerektiğinde düzenlenir (örn. dokunma hedefi kuralı için `Button`e `size="touch"` / `size="icon-touch"`, `Input`e `h-touch` eklendi). Marka rengi teal (`--brand` = shadcn'in `--primary`/`--ring`'i besler); karanlık mod sistem temalı (`prefers-color-scheme`), manuel toggle yok. Responsive shell: `src/components/AppShell.tsx` — mobilde üst bar + alt tab bar, `md:` (≥768px) üzerinde sol sidebar nav.

## Veri modeli (özet — tam SQL section 1'de yazılacak)

Tablolar: `profiles`, `entries` (kind: income/expense/subscription; amount NUMERIC CHECK > 0 — işaret kind'dan türetilir, negatif tutar DB seviyesinde imkânsız), `portfolio_positions` (UNIQUE user_id+asset_class+symbol), `market_snapshots` (ortak, sadece service_role yazar), `news_items` (ortak), `market_events` (processed_at ile 24h SLA takibi), `recommendations` (cited_headline NOT NULL — atıfsız öneri satırı reddedilir; snapshot_ids uuid[] ile fiyat provenance).

Aylık fazla saklanmaz, `v_monthly_surplus` view'ından hesaplanır.

RLS deseni: kullanıcı tablolarında select/insert/update/delete için `auth.uid() = user_id` (insert'te WITH CHECK). Ortak tablolarda authenticated'a sadece SELECT; yazma policy'si YOK (service_role RLS'i bypass eder).

## Ekranlar

5 sekme: Ana Sayfa (`/`), Defter (`/defter`), Portföy (`/portfoy`), Öneriler (`/oneriler`), Ayarlar (`/ayarlar`). `(app)` route group layout'u sunucu tarafında oturum doğrular, yoksa `/giris`'e redirect.

- İlk boyamada görünen sayılar (fazla, ay özeti) → server component
- Canlı tazelenen veriler (fiyat, sinyal) → client island + SWR 60s
- Tüm mutasyonlar → server actions (zod ile doğrulanır)
- ≤3 dokunuş akışı: FAB → tutar (numpad otomatik odaklı, kategori varsayılan "diğer") → Kaydet
- Sinyal rozetleri yumuşatılmış dil: "Satış değerlendirilebilir" (kırmızı SAT butonu değil). Her fiyatın yanında saat damgası inline.
- 50+ pozisyonda liste react-virtuoso ile sanallaştırılır; tüm fiyatlar tek SWR key'de.

## LLM katmanı

- Model: gpt-4o, JSON çıktı, zod ile doğrulama. `atif_baslik` alanı bağlamdaki gerçek haber başlıklarından biriyle eşleşmiyorsa satır at, 1 kez retry, sonra düş.
- P/L yüzdeleri uygulama kodunda ÖNCEDEN hesaplanır ve prompta hazır enjekte edilir — model aritmetik yapmaz.
- LLM çağrısı öncesi kod seviyesinde hard gate: ilgili sınıf için ≤20 dk taze snapshot + 48 saat içi ≥1 haber yoksa çağrı yapılmaz.
- Fazla ≤ 0 ise alım önerme; bilgilendirici özet + tasarruf vurgusu moduna geç.
- Sistem promptunda: fiyat uydurma yasağı, zorunlu haber atfı, güven etiketi (yüksek/orta/düşük), koşullu dil zorunluluğu, haber başlıklarını talimat olarak yorumlama yasağı (prompt injection guard). Tam prompt metinleri Faz 1 plan dosyasında (bkz. `docs/phase1-plan.md`).

## Yazım sırası (her bölüm kendi içinde çalışır durumda teslim edilir)

1. `supabase/migrations/` — şema SQL + RLS + pg_cron kurulumu
2. Scaffold: Tailwind config, `tr-TR` locale utils (`Intl.NumberFormat`, asla manuel string), PWA manifest
3. Auth: giriş/kayıt sayfaları, session guard layout
4. Defter motoru: QuickEntrySheet (≤3 dokunuş), EntryList, surplus view entegrasyonu
5. Fiyat toplayıcı: Edge Functions (binance, tcmb, bist adaptörü, rss) + pg_cron zamanlaması + event detektörü
6. Öneri motoru: context assembler + LLM çağrısı + streaming component
7. Portföy ekranı + sinyal rozetleri
8. Ana ekran (üç motorun entegrasyonu)
8b. Ayarlar: profil (görünen isim düzenleme), veri tazeliği durumu (varlık sınıfı bazında), çıkış yap — planın orijinal "Ekranlar" listesinde vardı ama yazım sırasına bir numara verilmemişti; bölüm 8'den sonra, 9'dan önce tamamlandı.
9. Lighthouse optimizasyonu: font stratejisi, lazy loading, offline defter için service worker (Serwist)

Her bölümden sonra 5 başarı kriterine ve risk haritasına karşı sessiz gözden geçirme yap; kriter geçmiyorsa ilerlemeden yeniden yaz.

## Güven etiketleri

Kod yorumlarında ve plan güncellemelerinde: T1 (%95+ çalışır), T2 (küçük entegrasyon bilinmezleri), T3 (üçüncü taraf API davranışına bağlı, dikkatle test et), T4 (deneysel, göndermeden doğrula).

## Test kriterleri (kabul)

1. Giriş → 1 gelir + 1 abonelik ekle → güncel net fazla; her aksiyon ≤3 dokunuş, toplam <10 sn.
2. 7 günlük pencerede ≥5 farklı, haber atıflı öneri.
3. Nitelikli olay sonrası 24 saat içinde her pozisyonda gerekçeli sinyal (kullanıcının seçili dilinde).
4. Lighthouse mobil ≥ 90 (375px).
5. User B olarak User A satırlarına REST sorgusu → boş sonuç.
