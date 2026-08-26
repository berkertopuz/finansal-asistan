-- 1) Grup YÖNETİCİLİĞİ artık devredilebilir.
-- 2) Mükerrer uyarıları ONAYLANABİLİR (bir daha gösterilmez).

-- ---------------------------------------------------------------------------
-- 1. Yöneticilik
-- ---------------------------------------------------------------------------
-- Bugüne kadar yetki `groups.created_by`ye bağlıydı: kurucu tek yöneticiydi ve
-- devredilemiyordu. Kurucu gruptan ayrılırsa geride yöneticisi olmayan bir
-- grup kalıyordu. Yetki artık üyelik satırında bir BAYRAK — devredilebilir,
-- birden fazla olabilir.
--
-- created_by SİLİNMİYOR: "bu grubu kim kurdu" ayrı bir olgu ve
-- v_group_members onu hâlâ gösterebilir. Ama YETKİ artık ondan gelmiyor.
alter table public.group_members
  add column is_admin boolean not null default false;

-- Mevcut kurucular yönetici oluyor — aksi halde bu migration'dan sonra hiçbir
-- grubun yöneticisi kalmazdı.
update public.group_members m
set is_admin = true
from public.groups g
where g.id = m.group_id and g.created_by = m.user_id;

create or replace function public.is_group_admin(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.is_admin
  );
$fn$;

revoke execute on function public.is_group_admin(uuid) from public;
grant execute on function public.is_group_admin(uuid) to authenticated;

-- Yetki kontrolü yapan her yer bayrağa geçiyor.
drop policy groups_update_owner on public.groups;
create policy groups_update_admin on public.groups
  for update using (public.is_group_admin(id)) with check (public.is_group_admin(id));

drop policy groups_delete_owner on public.groups;
create policy groups_delete_admin on public.groups
  for delete using (public.is_group_admin(id));

-- Yönetici atama/alma. Yalnızca yönetici yapabilir.
--
-- SON YÖNETİCİ KORUMASI: bir grup yöneticisiz kalamaz. Kendi yöneticiliğini
-- bırakmak isteyen biri önce başkasını yönetici yapmak zorunda — aksi halde
-- grup adı değiştirilemez, ayar değiştirilemez, üye çıkarılamaz hale gelirdi
-- ve bunu düzeltmenin uygulama içinden hiçbir yolu olmazdı.
create or replace function public.set_group_admin(
  target_group_id uuid,
  target_user_id uuid,
  make_admin boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  admin_count int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_group_admin(target_group_id) then
    raise exception 'not_group_admin';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = target_group_id and user_id = target_user_id
  ) then
    raise exception 'not_in_group';
  end if;

  if not make_admin then
    select count(*) into admin_count
    from public.group_members
    where group_id = target_group_id and is_admin;
    if admin_count <= 1 then
      raise exception 'last_admin';
    end if;
  end if;

  update public.group_members
    set is_admin = make_admin
  where group_id = target_group_id and user_id = target_user_id;
end;
$fn$;

-- leave_group da son yöneticiyi korumak zorunda: yönetici çıkıp giderse
-- grup sahipsiz kalır.
create or replace function public.leave_group(target_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  member_count int;
  admin_count int;
  is_last_admin boolean;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.group_members where user_id = uid and group_id = target_group_id
  ) then
    raise exception 'not_in_group';
  end if;

  select count(*) into member_count
  from public.group_members where group_id = target_group_id;
  select count(*) into admin_count
  from public.group_members where group_id = target_group_id and is_admin;
  select is_admin into is_last_admin
  from public.group_members where group_id = target_group_id and user_id = uid;

  -- Son üye değilsen ve tek yöneticiysen çıkamazsın: önce birini yönetici yap.
  if member_count > 1 and is_last_admin and admin_count <= 1 then
    raise exception 'last_admin';
  end if;

  update public.entries
    set group_id = null
  where user_id = uid and group_id = target_group_id;

  delete from public.group_members where user_id = uid and group_id = target_group_id;

  if not exists (select 1 from public.group_members where group_id = target_group_id) then
    delete from public.groups where id = target_group_id;
  end if;
end;
$fn$;

create or replace function public.remove_group_member(target_group_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'use_leave_group';
  end if;
  if not public.is_group_admin(target_group_id) then
    raise exception 'not_group_admin';
  end if;

  update public.entries
    set group_id = null
  where user_id = target_user_id and group_id = target_group_id;

  delete from public.group_members
  where user_id = target_user_id and group_id = target_group_id;
end;
$fn$;

-- create_group kurucuyu yönetici yapıyor.
create or replace function public.create_group(group_name text)
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
  if (select count(*) from public.group_members where user_id = uid) >= 20 then
    raise exception 'too_many_groups';
  end if;

  insert into public.groups (name, created_by)
  values (trim(group_name), uid)
  returning id into new_id;

  insert into public.group_members (group_id, user_id, is_admin)
  values (new_id, uid, true);

  return new_id;
end;
$fn$;

-- YÖNETİCİ, BAŞKASININ KAYDINI GRUPTAN ÇIKARABİLİR — ama SİLEMEZ.
--
-- Ayrım kasıtlı: o satır aynı zamanda sahibinin KENDİ defterinde ve kendi
-- bakiyesinde duruyor. Grubun toplamını düzeltmek için gruptan çıkarmak
-- yetiyor; kişinin defterini silmek gereksiz bir yan hasar ve bir çift
-- bütçesi uygulamasında geri dönüşü olmayan bir güven kaybı.
--
-- Neden RPC: entries'in UPDATE policy'si `auth.uid() = user_id` diyor ve
-- öyle kalmalı. RLS "yalnızca şu kolon değişebilir" diye bir kural
-- kuramıyor, o yüzden yetkiyi policy'yi gevşeterek değil, TEK BİR KOLONU
-- değiştiren definer bir fonksiyonla veriyoruz.
create or replace function public.detach_entry_as_admin(target_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  entry_group uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select group_id into entry_group from public.entries where id = target_entry_id;
  if entry_group is null then
    raise exception 'not_found';
  end if;
  if not public.is_group_admin(entry_group) then
    raise exception 'not_group_admin';
  end if;

  update public.entries set group_id = null where id = target_entry_id;
end;
$fn$;

revoke execute on function public.set_group_admin(uuid, uuid, boolean) from public;
revoke execute on function public.detach_entry_as_admin(uuid) from public;
grant execute on function public.set_group_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.detach_entry_as_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Mükerrer onayı
-- ---------------------------------------------------------------------------
-- Uyarı sezgisel: aynı tutar + yakın tarih + farklı ödeyen. Gerçekten iki
-- ayrı harcama olabilir (iki kişi aynı gün aynı marketten ayrı alışveriş
-- yapmış). Kullanıcı "bunlar farklı" dediğinde o çift bir daha sorulmamalı —
-- aksi halde uyarı kalıcı gürültüye dönüşür ve insanlar bakmayı bırakır.
--
-- Çift KANONİK saklanıyor (first < second): aynı çiftin iki farklı sırayla
-- iki kez kaydedilmesi imkânsız.
--
-- Kayıt silinirse (cascade) inceleme de düşüyor — zaten ortada çift kalmıyor.
create table public.group_duplicate_reviews (
  group_id        uuid not null references public.groups(id) on delete cascade,
  first_entry_id  uuid not null references public.entries(id) on delete cascade,
  second_entry_id uuid not null references public.entries(id) on delete cascade,
  reviewed_by     uuid not null references auth.users(id) on delete cascade,
  reviewed_at     timestamptz not null default now(),
  primary key (first_entry_id, second_entry_id),
  check (first_entry_id < second_entry_id)
);

create index group_duplicate_reviews_group_idx on public.group_duplicate_reviews (group_id);

alter table public.group_duplicate_reviews enable row level security;

-- Onay grubun ORTAK kararı: herhangi bir üye işaretleyebilir ve herkes görür.
-- Uyarının muhatabı iki kişi birden; birinin "bunlar farklı" demesi yeterli.
create policy group_duplicate_reviews_select_member on public.group_duplicate_reviews
  for select using (public.is_group_member(group_id));
create policy group_duplicate_reviews_insert_member on public.group_duplicate_reviews
  for insert with check (public.is_group_member(group_id) and reviewed_by = auth.uid());
create policy group_duplicate_reviews_delete_member on public.group_duplicate_reviews
  for delete using (public.is_group_member(group_id));

-- ---------------------------------------------------------------------------
-- 3. v_group_members yöneticilik bayrağını göstersin
-- ---------------------------------------------------------------------------
drop view public.v_group_members;

create view public.v_group_members
with (security_invoker = false) as
select
  m.group_id,
  m.user_id,
  m.joined_at,
  m.is_admin,
  p.display_name,
  (g.created_by = m.user_id) as is_creator
from public.group_members m
join public.profiles p on p.id = m.user_id
join public.groups g on g.id = m.group_id
where public.is_group_member(m.group_id);

grant select on public.v_group_members to authenticated;

-- Artık kullanılmıyor: yetki created_by'dan değil is_admin'den geliyor.
drop function public.is_group_owner(uuid);
