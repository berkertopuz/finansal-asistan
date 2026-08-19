-- Yurt dışı harcamaları ve döviz gelirleri.
--
-- `amount` HER ZAMAN TL kalıyor. Bilerek: currentBalance, nakit akışı,
-- v_monthly_surplus ve Analiz'in tamamı bu kolonu topluyor — dövizi oraya
-- sokmak her toplamı kırardı. Orijinal tutar ve kullanılan kur yanına ayrı
-- kolonlarda saklanıyor.
--
-- Kur KAYIT ANINDA KİLİTLENİYOR, okuma anında çevrilmiyor. Bir defterde
-- geçmiş ayların toplamı kur oynadıkça değişemez; ayrıca kullanıcı bankanın
-- kestiği gerçek kuru elle yazabildiği için saklanan değer "o gün TCMB ne
-- diyordu"dan farklı olabilir ve olması gereken de budur.
alter table public.entries
  add column original_amount   numeric(14,2),
  add column original_currency text,
  add column fx_rate           numeric(18,6),
  add column fx_rate_date      date;

-- Dördü birlikte dolu ya da dördü birlikte boş. Yarım doldurulmuş bir kayıt
-- ("50 EUR ama kur yok") TL karşılığını doğrulanamaz hale getirirdi.
alter table public.entries
  add constraint entries_fx_fields_consistent
    check (
      (original_amount is null and original_currency is null
        and fx_rate is null and fx_rate_date is null)
      or (original_amount > 0 and original_currency is not null
        and fx_rate > 0 and fx_rate_date is not null)
    );

-- TL'yi "yabancı para" olarak işaretlemek anlamsız: o zaman bu kolonlar boş
-- kalmalı.
alter table public.entries
  add constraint entries_original_currency_not_try
    check (original_currency is null or original_currency <> 'TRY');
