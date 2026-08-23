-- Öneri motorunu DURDUR — ilk sürümde olmayacak.
--
-- Öneriler sekmesi 0619f91'de kaldırıldı ("Replace the Öneriler tab with an
-- Analiz page") ama motor arkada çalışmaya devam ediyordu: her nitelikli
-- piyasa olayı bir gpt-4o çağrısı tetikliyor, günlük iki cron işi iki çağrı
-- daha yapıyor, ve üretilen satırları GÖSTEREN HİÇBİR EKRAN YOK. Yani
-- kimsenin bir şeye basması gerekmeden fatura işliyordu.
--
-- Bu migration yalnızca TETİKLEYİCİLERİ kaldırıyor; edge function'lar,
-- `recommendations` tablosu, RLS politikaları ve mevcut satırlar OLDUĞU GİBİ
-- duruyor. Motorun geri gelip gelmeyeceğine karar verilmedi, o yüzden veri
-- ya da kod silinmiyor — geri açmak bu dosyanın tersini yazmak kadar.
--
-- KAPSAM DIŞI (kasıtlı): poll-prices, poll-news ve detect-events çalışmaya
-- devam ediyor. Hiçbiri LLM çağırmıyor (fiyat/haber API'leri ücretsiz) ve
-- portföy ekranı taze fiyata muhtaç. detect-events `market_events` yazmaya
-- devam edecek, ama artık o satırlar hiçbir şeyi tetiklemiyor — motor geri
-- açılırsa 24 saatlik SLA takibi için tarihçe orada olur.

-- 1. LLM çağıran iki zamanlanmış iş.
--    cron.unschedule(name), iş yoksa hata atıyor; bu migration'ın hedef
--    ortamlarda (henüz kurulmamış bir kopya dahil) idempotent kalması için
--    varlık kontrolüyle sarıldı.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-signals-daily-safety') then
    perform cron.unschedule('generate-signals-daily-safety');
  end if;
  if exists (select 1 from cron.job where jobname = 'generate-buy-suggestions-daily') then
    perform cron.unschedule('generate-buy-suggestions-daily');
  end if;
end;
$$;

-- 2. Olay zincirinin LLM'e giden son halkası. Asıl maliyet buradaydı:
--    cron günde iki çağrıyla sınırlıyken bu tetikleyici HER market_events
--    satırı için bir gpt-4o çağrısı yapıyordu, yani piyasa oynadıkça
--    maliyet de oynuyordu.
drop trigger if exists market_events_after_insert on public.market_events;
drop function if exists private.trigger_generate_signals();
