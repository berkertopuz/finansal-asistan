-- Gider ile nakit çıkışını ayırmak: bir kredi kartı harcaması parayı ANINDA
-- hesaptan düşürmemeli — kart bir borç, gerçek nakit yalnızca kullanıcı o
-- borcu ödediğinde çıkar. 'card_payment', kullanıcının bir karta yaptığı
-- ödemeyi temsil ediyor — bir "gider" değil, nakitten kart borcuna bir
-- transfer. v_monthly_surplus'un income/expense CTE'leri zaten yalnızca
-- kind='income'/'expense' filtreliyor (bkz. 20260720130000_recurring_entry_templates.sql),
-- yeni kind otomatik olarak "aylık harcama" toplamının dışında kalıyor —
-- view'a dokunmaya gerek yok.
alter table public.entries
  drop constraint entries_kind_check,
  add constraint entries_kind_check
    check (kind in ('income', 'expense', 'subscription', 'investment', 'card_payment'));

-- Bir card_payment satırı hangi kartın borcunu azalttığını bilmek zorunda;
-- income/investment ise hiçbir zaman bir karta bağlı olamaz (nakitten
-- gelir, karta değil). expense/subscription için credit_card_id opsiyonel:
-- null = nakit/banka (bugünkü davranış), dolu = o karta yazıldı (borç
-- artışı — src/lib/cashflow.ts artık bu satırları nakit olayı olarak hiç
-- saymıyor, yalnızca creditCardDebtBalance'a dahil ediyor).
alter table public.entries
  add constraint entries_credit_card_id_kind_check
    check (
      (kind = 'card_payment' and credit_card_id is not null)
      or (kind in ('expense', 'subscription'))
      or (kind in ('income', 'investment') and credit_card_id is null)
    );

-- Bir ödeme her zaman tek seferlik, elle girilen bir olay — tekrarlayan bir
-- kural olamaz (entries_installment_requires_expense_and_concrete zaten
-- installment_group_id'yi kind='expense'e kilitlediği için taksitli de
-- olamaz, ek bir constraint gerekmiyor).
alter table public.entries
  add constraint entries_card_payment_recurrence_check
    check (kind <> 'card_payment' or recurrence = 'none');

-- Önceki oturumun cash_out_at'i (ekstre/abonelik satırlarına "tahmini ödeme
-- günü" damgalayıp kartın hep tam otomatik ödendiğini varsayıyordu) bu
-- modelle yer değiştiriyor: artık nakit çıkışı yalnızca gerçek card_payment
-- satırlarından geliyor (kullanıcı ne zaman, ne kadar ödediğini kendisi
-- bildiriyor — kısmi/asgari ödeme de doğru modellenmiş oluyor). Gelecekteki
-- tahmini ödeme artık kayıt bazında damgalanmıyor, src/lib/cashflow.ts'teki
-- projectBalance içinde projeksiyon anında hesaplanan sanal bir olay.
alter table public.entries
  drop column cash_out_at;
