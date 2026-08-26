-- HANE -> GRUP genelleştirmesi.
--
-- Kavram değişti: "hane" yalnızca bir kullanım şekliydi. İnsanlar aynı
-- mekanizmayı bir tatil ("Yurtdışı 2026"), bir düğün, bir tadilat için de
-- istiyor — ve tek kişilik de olabiliyor (kimseyle paylaşmadan kendi tatil
-- toplamını görmek). Bunların hepsi "adı olan bir kova + isteğe bağlı
-- üyeler"; ayrı bir etiket sistemi kurmak aynı şeyin ikinci bir kopyası
-- olurdu (kullanıcı açısından da: "ev neden grup, tatil neden etiket?").
--
-- KURAL: bir harcama TEK gruba girer. Kullanıcının kararı — "yurtdışıysa
-- yurtdışıdır, haneyse hanedir". Bu yüzden bağlantı tablosu değil, entries
-- üzerinde tek bir group_id kolonu kalıyor. Bir kaydın iki kovada olması
-- ihtiyacı doğarsa kolonu bağlantı tablosuna taşıyan bir migration yeter
-- (veri kaybı olmadan); tersi (baştan bağlantı tablosu kurup kullanılmadığını
-- görmek) geri alınamazdı.
--
-- unique(user_id) DÜŞÜYOR: bir kullanıcı artık birden çok grupta olabilir
-- (bir hane + iki tatil). Bu kısıt ilk sürümde formda "hangi hane?" seçicisi
-- doğmasın diye vardı; artık seçici zaten gerekiyor.
--
-- Adlandırma: rename ucuz ve yıkıcı değil, ama FONKSİYON GÖVDELERİ metin
-- olarak saklandığı için tablo rename'i onları OTOMATİK düzeltmiyor —
-- gövdesinde eski adı geçen her fonksiyon aşağıda yeniden yazılıyor.
-- Policy'ler tabloya bağlı olduğu için rename ile taşınıyor, yalnızca
-- adları eski kalıyor; onlar da yeniden adlandırılıyor.

-- ---------------------------------------------------------------------------
-- 1. Tablolar ve kolonlar
-- ---------------------------------------------------------------------------

alter table public.households rename to groups;
alter table public.household_members rename to group_members;
alter table public.household_invites rename to group_invites;
alter table public.household_merchant_rules rename to group_merchant_rules;

alter table public.group_members rename column household_id to group_id;
alter table public.group_invites rename column household_id to group_id;
alter table public.group_merchant_rules rename column household_id to group_id;

alter table public.entries rename column shared_household_id to group_id;

-- Bir kullanıcı artık N grupta olabilir.
alter table public.group_members drop constraint household_members_user_id_key;

-- ---------------------------------------------------------------------------
-- 2. Fonksiyonlar — gövdeleri eski tablo adlarını taşıdığı için YENİDEN yazılıyor
-- ---------------------------------------------------------------------------
-- Definer olma gerekçesi değişmedi: group_members'ın kendi SELECT policy'si
-- üyelik sorgusu içeriyor, düz bir alt sorgu sonsuz özyinelemeye düşer (42P17).

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$fn$;

create or replace function public.is_group_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.groups g
    where g.id = gid and g.created_by = auth.uid()
  );
$fn$;

revoke execute on function public.is_group_member(uuid) from public;
revoke execute on function public.is_group_owner(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policy'ler — eski fonksiyon adlarına baktıkları için yeniden kuruluyor
-- ---------------------------------------------------------------------------

drop policy households_select_member on public.groups;
drop policy households_update_owner on public.groups;
drop policy households_delete_owner on public.groups;
drop policy household_members_select_member on public.group_members;
drop policy household_invites_select_member on public.group_invites;
drop policy household_invites_insert_member on public.group_invites;
drop policy household_invites_delete_member on public.group_invites;
drop policy household_merchant_rules_select_member on public.group_merchant_rules;
drop policy household_merchant_rules_insert_member on public.group_merchant_rules;
drop policy household_merchant_rules_delete_member on public.group_merchant_rules;

create policy groups_select_member on public.groups
  for select using (public.is_group_member(id));
create policy groups_update_owner on public.groups
  for update using (public.is_group_owner(id)) with check (public.is_group_owner(id));
create policy groups_delete_owner on public.groups
  for delete using (public.is_group_owner(id));

create policy group_members_select_member on public.group_members
  for select using (public.is_group_member(group_id));

create policy group_invites_select_member on public.group_invites
  for select using (public.is_group_member(group_id));
create policy group_invites_insert_member on public.group_invites
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy group_invites_delete_member on public.group_invites
  for delete using (public.is_group_member(group_id));

create policy group_merchant_rules_select_member on public.group_merchant_rules
  for select using (public.is_group_member(group_id));
create policy group_merchant_rules_insert_member on public.group_merchant_rules
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy group_merchant_rules_delete_member on public.group_merchant_rules
  for delete using (public.is_group_member(group_id));

-- entries'in yazma koruması (20260825140000) — kolon adı değişti, fonksiyon
-- adı değişti. Gerekçe aynen duruyor: hane/grup id'sini sunucuda çözmek
-- UYGULAMA katmanının doğru davranması demek, GÜVENLİK değil; oturumu olan
-- biri PostgREST'e doğrudan POST atıp yabancı bir grubun görünümüne satır
-- yazabilirdi (sızma testinde 201 alınmıştı).
drop policy entries_insert_own on public.entries;
create policy entries_insert_own on public.entries
  for insert with check (
    auth.uid() = user_id
    and (group_id is null or public.is_group_member(group_id))
  );

drop policy entries_update_own on public.entries;
create policy entries_update_own on public.entries
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (group_id is null or public.is_group_member(group_id))
  );

-- ---------------------------------------------------------------------------
-- 4. Kısıtlar ve indeksler
-- ---------------------------------------------------------------------------

alter table public.entries rename constraint entries_shared_kind_check to entries_group_kind_check;
alter index entries_shared_household_idx rename to entries_group_idx;

-- ---------------------------------------------------------------------------
-- 5. RPC'ler — hepsi eski adları taşıyor, yeniden yazılıyor
-- ---------------------------------------------------------------------------
-- "Tüm mutasyonlar definer RPC'den geçer" kararı aynen duruyor (kural 8):
-- tablolarda kullanıcıya açık INSERT/UPDATE policy'si yok, yoksa davet
-- mekanizması tamamen atlanabilirdi.

drop function public.create_household(text);
drop function public.accept_household_invite(text);
drop function public.leave_household();
drop function public.remove_household_member(uuid);

-- already_in_household kontrolü GİTTİ: çoklu üyelik artık normal.
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

  -- Kural 8: sınırsız grup açmak bir suistimal yüzeyi (her grup davet
  -- üretebiliyor). 20 tane bir insan için fazlasıyla yeterli.
  if (select count(*) from public.group_members where user_id = uid) >= 20 then
    raise exception 'too_many_groups';
  end if;

  insert into public.groups (name, created_by)
  values (trim(group_name), uid)
  returning id into new_id;

  insert into public.group_members (group_id, user_id)
  values (new_id, uid);

  return new_id;
end;
$fn$;

create or replace function public.accept_group_invite(invite_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  inv public.group_invites;
  member_count int;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into inv
  from public.group_invites
  where token_hash = invite_token_hash
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invalid_or_expired_invite';
  end if;

  -- Aynı gruba ikinci kez katılmak sessizce çift üyelik yaratmasın (PK zaten
  -- engelliyor, ama mesajı biz veriyoruz).
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = uid) then
    raise exception 'already_in_group';
  end if;

  select count(*) into member_count
  from public.group_members where group_id = inv.group_id;
  if member_count >= 8 then
    raise exception 'group_full';
  end if;

  insert into public.group_members (group_id, user_id)
  values (inv.group_id, uid);

  update public.group_invites
    set accepted_at = now(), accepted_by = uid
  where id = inv.id;

  return inv.group_id;
end;
$fn$;

-- Ayrılan üyenin geçmiş kayıtları grupta ASILI KALMAMALI. Kayıt SİLİNMİYOR,
-- yalnızca grup işareti kalkıyor. Artık HANGİ gruptan ayrıldığı parametre —
-- kullanıcı birden çok grupta olabiliyor.
create or replace function public.leave_group(target_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.group_members where user_id = uid and group_id = target_group_id
  ) then
    raise exception 'not_in_group';
  end if;

  update public.entries
    set group_id = null
  where user_id = uid and group_id = target_group_id;

  delete from public.group_members where user_id = uid and group_id = target_group_id;

  -- Son üye de çıktıysa grup bir kabuk olarak kalmasın.
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
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if target_user_id = uid then
    raise exception 'use_leave_group';
  end if;
  if not public.is_group_owner(target_group_id) then
    raise exception 'not_group_owner';
  end if;

  update public.entries
    set group_id = null
  where user_id = target_user_id and group_id = target_group_id;

  delete from public.group_members
  where user_id = target_user_id and group_id = target_group_id;
end;
$fn$;

revoke execute on function public.create_group(text) from public;
revoke execute on function public.accept_group_invite(text) from public;
revoke execute on function public.leave_group(uuid) from public;
revoke execute on function public.remove_group_member(uuid, uuid) from public;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.accept_group_invite(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. View'lar
-- ---------------------------------------------------------------------------
-- security_invoker AÇIKÇA false: view sahibi olarak çalışıp entries'in
-- RLS'ini atlıyor ve kapsamı WHERE ile kendisi kuruyor. entries_select_own'a
-- DOKUNULMUYOR — genişletilseydi başkasının satırları getEntries'e sızıp
-- kullanıcının KENDİ bakiyesini ve Analiz'ini bozardı (CLAUDE.md).

drop view public.v_household_entries;
drop view public.v_household_members;

-- Eski yardımcılar ancak BURADA düşebilir: hem policy'ler hem de eski
-- view'lar onlara bağlıydı ve ikisi de bu noktada temizlendi. Gövdeleri artık
-- var olmayan tablo adlarını taşıdığı için zaten bozuklar — geride bırakmak,
-- çağrıldığında çalışma zamanında patlayan bir tuzak olurdu.
drop function public.is_household_member(uuid);
drop function public.is_household_owner(uuid);

create view public.v_group_entries
with (security_invoker = false) as
select
  e.id,
  e.user_id,
  e.group_id,
  e.kind,
  e.amount,
  e.category,
  e.description,
  e.occurred_at,
  e.credit_card_id,
  p.display_name as payer_name
from public.entries e
join public.profiles p on p.id = e.user_id
where e.group_id is not null
  and public.is_group_member(e.group_id);

grant select on public.v_group_entries to authenticated;

create view public.v_group_members
with (security_invoker = false) as
select
  m.group_id,
  m.user_id,
  m.joined_at,
  p.display_name,
  (g.created_by = m.user_id) as is_owner
from public.group_members m
join public.profiles p on p.id = m.user_id
join public.groups g on g.id = m.group_id
where public.is_group_member(m.group_id);

grant select on public.v_group_members to authenticated;
