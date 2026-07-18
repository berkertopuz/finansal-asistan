@AGENTS.md

# Finansal Asistan — Proje Brief (Claude Code için)

Kişisel kullanım için Türkçe bir PWA: nakit akışı defteri + haber tetiklemeli yatırım sinyal motoru (BIST, altın, kripto, döviz). Next.js App Router + TypeScript + Tailwind + Supabase + GPT-4o.

## Kesin kurallar (pazarlıksız)

1. **Dil:** Tüm UI metinleri, hata mesajları ve LLM promptları Türkçe. Kod yorumları İngilizce olabilir.
2. **Yasal:** Her öneri yüzeyinin EN ÜSTÜNDE, sunucu tarafında statik olarak şu metin basılır (LLM'e bırakılmaz): "Bu öneriler yalnızca bilgilendirme amaçlıdır; yatırım tavsiyesi niteliği taşımaz. SPK lisanslı bir danışmana başvurunuz."
3. **Auth:** Geçerli oturum olmadan hiçbir finansal veri render edilmez. Supabase Auth (email/şifre + Google OAuth). Tüm kullanıcı tablolarında RLS: `auth.uid() = user_id`.
4. **Mobil:** 375px viewport, dokunma hedefleri ≥ 48px, yatay scroll yok, Lighthouse mobil ≥ 90. Gelir/gider ekleme ana ekrandan ≤ 3 dokunuş.
5. **Fiyat uydurma yasak:** LLM bağlamına giren her fiyat aynı istek döngüsünde canlı API'den gelir. API düşerse o varlık sınıfı için "Veri alınamadı — öneri ertelendi" gösterilir; bayat/uydurma veri asla.
6. **Tazelik:** Nitelikli olay (BIST-100 ±%2, USD/TRY ±%1.5, faiz kararı, TÜFE) sonrası 24 saat içinde pozisyon sinyalleri yenilenir. Haftada ≥ 5 yeni alım önerisi.

## Onaylanmış mimari kararlar

- **BIST verisi:** 15 dk gecikmeli ücretsiz veri, `lib/providers/` altında değiştirilebilir adaptör arayüzü (`PriceProvider` interface). Investing.com kazıma YAPMA (T4). Gecikme UI'da açıkça gösterilir.
- **Haberler:** NewsAPI değil, Türk RSS beyaz listesi: AA, Bloomberg HT, Dünya, Reuters TR. `fast-xml-parser` ile parse.
- **Cron:** Vercel Cron değil, Supabase pg_cron + Edge Functions.
- **Kripto:** Binance public API (`/api/v3/ticker/price`). **Döviz:** TCMB `today.xml` (günlük) + Binance USDT/TRY cross-rate fallback (fallback kullanılınca güven en fazla "orta").

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
9. Lighthouse optimizasyonu: font stratejisi, lazy loading, offline defter için service worker (Serwist)

Her bölümden sonra 5 başarı kriterine ve risk haritasına karşı sessiz gözden geçirme yap; kriter geçmiyorsa ilerlemeden yeniden yaz.

## Güven etiketleri

Kod yorumlarında ve plan güncellemelerinde: T1 (%95+ çalışır), T2 (küçük entegrasyon bilinmezleri), T3 (üçüncü taraf API davranışına bağlı, dikkatle test et), T4 (deneysel, göndermeden doğrula).

## Test kriterleri (kabul)

1. Giriş → 1 gelir + 1 abonelik ekle → güncel net fazla; her aksiyon ≤3 dokunuş, toplam <10 sn.
2. 7 günlük pencerede ≥5 farklı, haber atıflı öneri.
3. Nitelikli olay sonrası 24 saat içinde her pozisyonda gerekçeli Türkçe sinyal.
4. Lighthouse mobil ≥ 90 (375px).
5. User B olarak User A satırlarına REST sorgusu → boş sonuç.
