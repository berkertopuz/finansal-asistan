-- Ortak/hane bütçesi. Modelin tamamı ve NEDEN böyle olduğu CLAUDE.md
-- "Onaylanmış mimari kararlar" > "Ortak/hane bütçesi" maddesinde.
--
-- Bu migration'ın tek cümlelik özeti: kişisel defter OLDUĞU GİBİ kalıyor.
-- entries üzerindeki hiçbir mevcut policy'ye, v_monthly_surplus'a ve
-- src/lib/cashflow.ts + analysis.ts'in dayandığı hiçbir varsayıma
-- dokunulmuyor — "ortak" yalnızca entries üzerinde bir İŞARET, ve o işaretli
-- satırlar AYRI bir okuma yolundan (v_household_entries) görülüyor.

-- ---------------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------------

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) > 0 and char_length(name) <= 60),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- unique(user_id): ilk sürümde bir kullanıcı aynı anda TEK hanede olabilir.
-- Kısıt kasıtlı — kayıt formunda ve hane ekranında "hangi hane?" seçicisi
-- doğmuyor, çift/aile senaryosu için fazlasıyla yeterli. Gevşetmek ileride
-- bu constraint'i düşürmek + seçici eklemek demek.
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade unique,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

-- Ham token DB'ye HİÇ yazılmıyor: uygulama rastgele bir token üretip linke
-- koyuyor, buraya yalnızca sha256 özetini yazıyor, kabul ederken de gelen
-- token'ı yine uygulama tarafında özetleyip RPC'ye özeti veriyor. Böylece
-- bir DB dökümü davet linklerini kullanılabilir halde içermiyor.
create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by   uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index household_invites_household_idx on public.household_invites (household_id);

-- Ekstre satırlarını ön-işaretlemek için öğrenilen satıcı kuralları.
-- merchant_key normalize edilmiş açıklama (uygulama tarafında üretilir) —
-- deterministik, LLM yok. Kural yalnızca ÖN-İŞARETLER, onayı ortadan
-- kaldırmaz (bkz. CLAUDE.md: yanlış pozitifin bedeli asimetrik).
create table public.household_merchant_rules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  merchant_key text not null check (char_length(trim(merchant_key)) > 0 and char_length(merchant_key) <= 120),
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (household_id, merchant_key)
);

-- ---------------------------------------------------------------------------
-- 2. Üyelik yardımcıları — DEFINER olmak ZORUNDA
-- ---------------------------------------------------------------------------
-- household_members'ın kendi SELECT policy'si "bu satır benim üyesi olduğum
-- bir haneye mi ait" diye soruyor. Bunu düz bir alt sorguyla yazmak
-- policy'nin kendi tablosunu tekrar okuması demek ve Postgres sonsuz
-- özyinelemeye düşer (42P17). SECURITY DEFINER fonksiyon RLS'i atlayarak
-- döngüyü kırıyor. search_path sabitleniyor: definer bir fonksiyonda arama
-- yolunu çağırana bırakmak yetki yükseltme yoludur.

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$fn$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.households h
    where h.id = hid and h.created_by = auth.uid()
  );
$fn$;

revoke execute on function public.is_household_member(uuid) from public;
revoke execute on function public.is_household_owner(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. entries / credit_cards üzerindeki işaretler
-- ---------------------------------------------------------------------------

-- on delete set null: hane silinirse kayıtlar KAYBOLMAZ, yalnızca kişiselleşir.
alter table public.entries
  add column shared_household_id uuid references public.households(id) on delete set null,
  add column counterpart_share numeric;

-- Yalnızca harcama paylaşılabilir. Gelir/yatırım/kart ödemesi hane
-- görünümüne girerse "bu ay ortak giderler ne tuttu" toplamı anlamını
-- kaybeder (card_payment zaten bir transfer, harcama değil — bkz.
-- 20260724120000_credit_card_debt_model.sql).
alter table public.entries
  add constraint entries_shared_kind_check
    check (shared_household_id is null or kind in ('expense', 'subscription'));

-- counterpart_share bir ETİKET: "1.000 ödedim, 400'ü onun payı". Borç
-- doğurmuyor, hiçbir toplamı değiştirmiyor (hane toplamı yine 1.000),
-- yalnızca hane ekranındaki atıf satırını değiştiriyor. Paylaşılmamış bir
-- satırda anlamsız, ve harcamanın tamamından büyük olamaz.
alter table public.entries
  add constraint entries_counterpart_share_check
    check (
      counterpart_share is null
      or (shared_household_id is not null and counterpart_share > 0 and counterpart_share < amount)
    );

create index entries_shared_household_idx
  on public.entries (shared_household_id, occurred_at)
  where shared_household_id is not null;

-- Çoğu çiftte zaten bir "ev kartı" var — ekstre inceleme ekranında o karttan
-- gelen satırları ön-işaretlemek, satıcı kuralından daha güçlü ve
-- kullanıcının kafasındaki modelle birebir örtüşen sinyal.
alter table public.credit_cards
  add column shared_by_default boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. RLS — okuma policy'si var, kullanıcıya açık YAZMA policy'si (çoğunlukla) YOK
-- ---------------------------------------------------------------------------
-- Kural 8: kayıt herkese açık, oturumu olan kullanıcı güvenilmez. Eğer
-- household_members'a INSERT policy verilseydi ("kendini ekleyebilirsin"),
-- davet mekanizması tamamen atlanabilir ve oturumu olan biri doğrudan REST
-- üzerinden yabancı bir haneye katılabilirdi. Üyelik doğuran her mutasyon
-- aşağıdaki definer RPC'lerden geçiyor; invariant'lar (davet geçerli mi,
-- kullanıcı zaten bir hanede mi, üye sayısı sınırı) orada zorlanıyor.

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.household_merchant_rules enable row level security;

create policy households_select_member on public.households
  for select using (public.is_household_member(id));
create policy households_update_owner on public.households
  for update using (public.is_household_owner(id)) with check (public.is_household_owner(id));
create policy households_delete_owner on public.households
  for delete using (public.is_household_owner(id));

create policy household_members_select_member on public.household_members
  for select using (public.is_household_member(household_id));

-- Davet OLUŞTURMA sıradan bir üye işlemi (RPC gerektirmiyor: yeni bir yetki
-- vermiyor, yalnızca bir token özeti yazıyor). KABUL etmek ise RPC'den
-- geçiyor, çünkü üyelik orada doğuyor.
create policy household_invites_select_member on public.household_invites
  for select using (public.is_household_member(household_id));
create policy household_invites_insert_member on public.household_invites
  for insert with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy household_invites_delete_member on public.household_invites
  for delete using (public.is_household_member(household_id));

create policy household_merchant_rules_select_member on public.household_merchant_rules
  for select using (public.is_household_member(household_id));
create policy household_merchant_rules_insert_member on public.household_merchant_rules
  for insert with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy household_merchant_rules_delete_member on public.household_merchant_rules
  for delete using (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- 5. Mutasyon RPC'leri
-- ---------------------------------------------------------------------------

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if exists (select 1 from public.household_members where user_id = uid) then
    raise exception 'already_in_household';
  end if;

  insert into public.households (name, created_by)
  values (trim(household_name), uid)
  returning id into new_id;

  insert into public.household_members (household_id, user_id)
  values (new_id, uid);

  return new_id;
end;
$fn$;

create or replace function public.accept_household_invite(invite_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  inv public.household_invites;
  member_count int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if exists (select 1 from public.household_members where user_id = uid) then
    raise exception 'already_in_household';
  end if;

  select * into inv
  from public.household_invites
  where token_hash = invite_token_hash
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invalid_or_expired_invite';
  end if;

  -- Kural 8: ücretli uçlar hane bazında kotalanacak, yani hane büyüklüğü bir
  -- suistimal yüzeyi. Çift/aile senaryosu için 8 fazlasıyla yeterli.
  select count(*) into member_count
  from public.household_members where household_id = inv.household_id;
  if member_count >= 8 then
    raise exception 'household_full';
  end if;

  insert into public.household_members (household_id, user_id)
  values (inv.household_id, uid);

  update public.household_invites
    set accepted_at = now(), accepted_by = uid
  where id = inv.id;

  return inv.household_id;
end;
$fn$;

-- Ayrılan üyenin geçmiş kayıtları hanede ASILI KALMAMALI: aksi halde artık
-- üye olmayan birinin harcamaları kalan üyelerin hane toplamında görünmeye
-- devam ederdi. Kayıt SİLİNMİYOR, yalnızca işareti kalkıyor (kişiselleşiyor).
create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select household_id into hid from public.household_members where user_id = uid;
  if hid is null then
    raise exception 'not_in_household';
  end if;

  update public.entries
    set shared_household_id = null, counterpart_share = null
  where user_id = uid and shared_household_id = hid;

  delete from public.household_members where user_id = uid and household_id = hid;

  -- Son üye de çıktıysa hane bir kabuk olarak kalmasın.
  if not exists (select 1 from public.household_members where household_id = hid) then
    delete from public.households where id = hid;
  end if;
end;
$fn$;

create or replace function public.remove_household_member(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if target_user_id = uid then
    raise exception 'use_leave_household';
  end if;

  select household_id into hid from public.household_members where user_id = target_user_id;
  if hid is null or not public.is_household_owner(hid) then
    raise exception 'not_household_owner';
  end if;

  update public.entries
    set shared_household_id = null, counterpart_share = null
  where user_id = target_user_id and shared_household_id = hid;

  delete from public.household_members where user_id = target_user_id and household_id = hid;
end;
$fn$;

revoke execute on function public.create_household(text) from public;
revoke execute on function public.accept_household_invite(text) from public;
revoke execute on function public.leave_household() from public;
revoke execute on function public.remove_household_member(uuid) from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.remove_household_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Hane okuma yolu — entries'in KENDİ policy'sinden AYRI
-- ---------------------------------------------------------------------------
-- security_invoker AÇIKÇA false (varsayılan zaten bu, ama burada sessizlik
-- tehlikeli olurdu): view sahibi olarak çalışıp entries'in RLS'ini atlıyor ve
-- kapsamı WHERE ile kendisi kuruyor. entries_select_own'a DOKUNULMAMASININ
-- sebebi tam olarak bu — o policy genişletilseydi eşin satırları getEntries'e
-- sızıp kullanıcının kendi bakiyesini, nakit akışını ve Analiz'ini bozardı
-- (bkz. CLAUDE.md, "entries_select_own GENİŞLETİLMEZ").

create or replace view public.v_household_entries
with (security_invoker = false) as
select
  e.id,
  e.user_id,
  e.shared_household_id as household_id,
  e.kind,
  e.amount,
  e.counterpart_share,
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

create or replace view public.v_household_members
with (security_invoker = false) as
select
  m.household_id,
  m.user_id,
  m.joined_at,
  p.display_name,
  (h.created_by = m.user_id) as is_owner
from public.household_members m
join public.profiles p on p.id = m.user_id
join public.households h on h.id = m.household_id
where public.is_household_member(m.household_id);

grant select on public.v_household_members to authenticated;
