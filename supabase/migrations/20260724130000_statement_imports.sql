-- Her ekstre yüklemesinin kalıcı kaydı — "hangi kart, hangi dönem, ne zaman,
-- kaç işlem" sorularına Kartlar sayfasından cevap verebilmek için. Öncesinde
-- bir ekstre yüklenip onaylandıktan sonra hiçbir iz bırakmıyordu, kullanıcı
-- hangi ayı yüklediğini hatırlayamıyordu.
--
-- statement_date = PDF'ten ayrıştırılan Hesap Kesim/Ekstre Tarihi (zaten
-- extractStatementText'in header'ında var, src/lib/statement-import/extract.ts)
-- — dönemin kesin kimliği, "ay" yerine bunu kullanmak QNB gibi ayın farklı
-- günlerinde kesilen kartlarda da belirsizliğe yer bırakmıyor.
create table public.statement_imports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  credit_card_id    uuid not null references public.credit_cards(id) on delete cascade,
  statement_date    date not null,
  payment_due_date  date,
  imported_count    smallint not null check (imported_count > 0),
  imported_total    numeric not null check (imported_total >= 0),
  created_at        timestamptz not null default now(),
  -- Aynı kart için aynı kesim tarihi iki kez kaydedilemez — "bu ekstreyi
  -- daha önce yükledim mi?" sorusunun DB seviyesinde son güvenlik ağı
  -- (StatementUploadSheet.tsx ayrıca yüklemeden ÖNCE de uyarır).
  unique (credit_card_id, statement_date)
);

create index statement_imports_card_idx on public.statement_imports (credit_card_id);

alter table public.statement_imports enable row level security;

create policy statement_imports_select_own on public.statement_imports
  for select using (auth.uid() = user_id);
create policy statement_imports_insert_own on public.statement_imports
  for insert with check (auth.uid() = user_id);
create policy statement_imports_delete_own on public.statement_imports
  for delete using (auth.uid() = user_id);

-- Bu ekstreden gelen her entries satırını izliyor — "bu yüklemeyi geri al"
-- (Kartlar sayfasındaki geçmiş listesinden, undoStatementImport) bu FK
-- sayesinde tek bir delete ile hem statement_imports satırını hem ürettiği
-- TÜM entries satırlarını temizleyebiliyor. portfolio_position_id'nin
-- entries üzerindeki ON DELETE CASCADE deseniyle aynı mantık
-- (20260721120000_investment_kind_and_manual_asset.sql) — bir ekstre
-- yüklemesi ile ürettiği satırlar tek bir atomik "bu oldu" gerçeği, birini
-- silmek diğerini de siler.
alter table public.entries
  add column statement_import_id uuid references public.statement_imports(id) on delete cascade;
