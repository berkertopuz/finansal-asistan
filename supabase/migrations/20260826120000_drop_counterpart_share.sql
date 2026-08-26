-- Pay etiketi (counterpart_share) KALDIRILDI.
--
-- 20260825120000_households.sql ile gelmişti: "1.000 ödedim, 400'ü onun
-- payı" diyebilmek için bir etiket. Hiçbir toplamı değiştirmiyor, borç
-- doğurmuyordu — yalnızca hane ekranındaki atıf satırını oynatıyordu.
--
-- NEDEN GİTTİ: modelin kendisi zaten "kim ödediyse gider ona yazılır, hane
-- toplamına eklenir" diyor. Bu ekran bilerek uzlaşma/borç hesabı yapmıyor,
-- dolayısıyla etiketin çıktısını tüketen hiçbir şey yoktu — kimsenin eyleme
-- dökmediği bir sayıydı. Buna karşılık maliyeti gerçekti: formda fazladan
-- bir alan, özet fonksiyonunda "yalnızca tam iki kişilik hanede
-- atfedilebilir" özel durumu ve "kalabalık hanede kime yazılacağı belirsiz"
-- uyarısı, ve arayüzde çelişki gibi okunan bir satır ("Neda ₺400,00 ·
-- ödedi ₺0,00" — kullanıcı bildirdi).
--
-- Kolon BIRAKILMIYOR: yazılmayan ama duran bir kolon sonraki oturumda
-- "bu canlı mı?" sorusu doğuruyor. Öneri motorunun kasıtlı bırakılmış
-- tabloları gibi bir durum değil bu — o motor geri gelebilir, bu fikirden
-- vazgeçildi.
--
-- Geri getirmek gerekirse: kolonu ve entries_counterpart_share_check'i
-- yeniden eklemek yeterli, başka hiçbir şey ona bağlı değil.

-- SIRA ÖNEMLİ. v_household_entries bu kolonu seçiyor, yani kolon ona bağımlı
-- ve önce view düşmeli. Ayrıca `create or replace view` bir kolonu
-- KALDIRAMAZ (Postgres: "cannot drop columns from view"), o yüzden replace
-- değil drop + create.
drop view public.v_household_entries;

alter table public.entries
  drop constraint entries_counterpart_share_check;

alter table public.entries
  drop column counterpart_share;

-- Geri kalanı 20260825120000'daki tanımın aynısı — güvenlik gerekçesi orada
-- yazılı: security_invoker AÇIKÇA false, kapsamı WHERE kuruyor,
-- entries_select_own'a dokunulmuyor.
create view public.v_household_entries
with (security_invoker = false) as
select
  e.id,
  e.user_id,
  e.shared_household_id as household_id,
  e.kind,
  e.amount,
  e.category,
  e.description,
  e.occurred_at,
  e.credit_card_id,
  p.display_name as payer_name
from public.entries e
join public.profiles p on p.id = e.user_id
where e.shared_household_id is not null
  and public.is_household_member(e.shared_household_id);

grant select on public.v_household_entries to authenticated;
