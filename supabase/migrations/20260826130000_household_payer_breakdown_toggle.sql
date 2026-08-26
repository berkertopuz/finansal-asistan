-- "Kim ne ödedi" kırılımı hane bazında kapatılabilir.
--
-- Gerekçe: bazı çiftler ortak gideri birlikte görmek istiyor ama kimin ne
-- kadar koyduğunu ekranda tutmak istemiyor — o bilgi ilişkiye göre ya
-- yararlı ya da gereksiz bir kıyas kaynağı. Uygulamanın bu konuda bir
-- görüşü yok (hane ekranı zaten adalet hesaplamıyor), o yüzden karar haneye
-- bırakılıyor.
--
-- Varsayılan TRUE: mevcut haneler ve yeni haneler bugünkü davranışı
-- sürdürüyor, kapatmak açık bir tercih.
--
-- Yetki: ayrı bir policy GEREKMİYOR. households_update_owner
-- (20260825120000_households.sql) zaten UPDATE'i is_household_owner()'a
-- kilitliyor — hem USING hem WITH CHECK tarafında. Yani bu kolonu yalnızca
-- haneyi kuran kişi değiştirebilir, üyeler okuyabilir ama yazamaz.
alter table public.households
  add column show_payer_breakdown boolean not null default true;
