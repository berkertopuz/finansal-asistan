-- Bug: nakit akışı tablosu, kredi kartı ekstresinden içe aktarılan
-- giderleri işlem (satın alma) tarihinde bakiyeden düşüyordu — ama o para
-- gerçekte hesaptan ekstrenin son ödeme tarihinde çıkıyor, satın alma
-- gününde değil (kart harcaması, ödemesi yapılana kadar bir borç, nakit
-- çıkışı değil). cash_out_at, yalnızca ekstre içe aktarımından gelen
-- satırlarda dolduruluyor (importStatementEntries, src/lib/actions/statements.ts
-- — o ekstrenin ayrıştırılan son ödeme tarihiyle); null ise nakit akışı
-- hesaplamaları (src/lib/cashflow.ts) occurred_at'e düşüyor, yani elle
-- girilen harcamalar (nakit/banka kartı — aynı gün ödendiği varsayılır)
-- eskisi gibi davranmaya devam ediyor. occurred_at kendisi bilerek
-- değişmiyor: Defter listesi ve v_monthly_surplus hâlâ "ne zaman harcandı"
-- göstermeli (bütçe takibi), cash_out_at yalnızca "bakiye ne zaman düşer"
-- sorusuna cevap veriyor (nakit akışı projeksiyonu) — ikisi kasıtlı olarak
-- farklı sorular.
alter table public.entries
  add column cash_out_at date;
