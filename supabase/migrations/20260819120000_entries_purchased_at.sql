-- Sorun: ekstreden içe aktarılan bir TAKSİT satırı yanlış aya yazılıyordu.
--
-- Bankalar taksitli bir alışverişi her ekstrede ORİJİNAL ALIŞVERİŞ TARİHİYLE
-- tekrar yazıyor (gerçek bir QNB ekstresinde doğrulandı: Mayıs-Haziran
-- dönemine ait ekstrede 21/04 tarihli, "2/3" göstergeli satırlar var).
-- importStatementEntries (src/lib/actions/statements.ts) occurred_at'e o
-- tarihi yazdığı için, Mart'ta alınan bir şeyin Temmuz'da gelen 5. taksiti
-- MART'ın harcamasına ekleniyordu. Sonuç: geçmiş ayların toplamı her yeni
-- ekstre yüklendikçe büyüyor, ve o para aslında Temmuz'da çıkıyor. Hem
-- v_monthly_surplus hem Analiz sayfasının aylık kırılımları bundan etkileniyordu.
--
-- Çözüm: iki tarihi ayırmak. occurred_at'in anlamı DEĞİŞMİYOR — "bu tutar
-- hangi döneme düşüyor" (Defter listesi, v_monthly_surplus ve Analiz bunu
-- topluyor). purchased_at yeni ve yalnızca "asıl alışveriş ne zaman yapıldı"
-- sorusuna cevap veriyor; iki tarih aynıysa null kalıyor.
--
-- Bu, önceki oturumların cash_out_at'i DEĞİL (20260723160000 ile eklenip
-- 20260724120000 ile düşürülmüştü). O kolon "nakit ne zaman çıkar" tahminini
-- satır bazında damgalıyordu ve kartın her zaman tam otomatik ödendiğini
-- varsaydığı için reddedilmişti; nakit çıkışı bugün gerçek card_payment
-- satırlarından geliyor ve o karar yerinde duruyor. purchased_at bir tahmin
-- değil, ekstrede yazan bir olgu — farklı bir soru, farklı bir kolon.
alter table public.entries
  add column purchased_at date;

comment on column public.entries.purchased_at is
  'Asıl alışverişin yapıldığı tarih, occurred_at''ten (tutarın düştüğü dönem) farklı olduğunda. Yalnızca ekstreden içe aktarılan, ilk taksitten sonraki taksit satırlarında dolu; diğer her satırda null (iki tarih aynı demektir).';

-- purchased_at yalnızca occurred_at'ten FARKLI olduğunda anlamlı: aynı
-- tarihi iki kolona yazmak, okuyan tarafta "acaba kasıtlı mı" sorusu
-- doğuruyor. Ayrıca alışveriş, tutarın düştüğü dönemden sonra olamaz.
alter table public.entries
  add constraint entries_purchased_at_before_occurred
    check (purchased_at is null or purchased_at < occurred_at);
