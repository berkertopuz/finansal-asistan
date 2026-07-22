-- last4 kaldırıldı: bir "kart adı" alanının yanında 4 haneli bir alan
-- olması, tarayıcıların (Chrome vb.) bunu gerçek bir ödeme formu sanıp
-- kullanıcının kayıtlı GERÇEK kartının bilgisini otomatik doldurmaya
-- çalışmasına yol açtı (gözlemlendi) — alan hiç önemli değildi, kaldırmak
-- hem bu riski ortadan kaldırıyor hem formu sadeleştiriyor. Hiçbir satırda
-- gerçek veri yoktu (özellik henüz test aşamasındaydı).
alter table public.credit_cards
  drop column last4;
