-- GÜVENLİK DÜZELTMESİ. 20260825120000_households.sql `entries`'e
-- shared_household_id ekledi ama entries'in YAZMA policy'leri yalnızca
-- "satır senin mi" diye soruyordu (auth.uid() = user_id) — o kolonun
-- işaret ettiği hanenin ÜYESİ olup olmadığını hiç kontrol etmiyordu.
--
-- Gerçek bir sızma testinde doğrulandı: oturumu olan bir kullanıcı, Next
-- uygulamasını tamamen atlayıp doğrudan PostgREST'e
--   POST /rest/v1/entries {user_id: <kendi>, shared_household_id: <yabancı hane>}
-- gönderdiğinde satır 201 ile YAZILDI ve o satır yabancı hanenin ortak
-- görünümüne (v_household_entries) düşüyordu. Uygulama katmanı bu hatayı
-- yapmıyor (resolveSharedHouseholdId, src/lib/actions/entries.ts, hane
-- id'sini istemciden HİÇ almıyor, sunucuda çözüyor) — ama kural 8'in tam
-- olarak söylediği şey bu: kayıt herkese açık, oturumu olan kullanıcı
-- güvenilmez ve arayüzü atlayabilir. Güvenlik arayüzde değil policy'de
-- durmalı.
--
-- KAPSAM: yalnızca INSERT/UPDATE sıkılaştırılıyor. entries_select_own'a
-- DOKUNULMUYOR (CLAUDE.md'deki en kritik kural — genişletilirse eşin
-- satırları getEntries'e sızıp kullanıcının kendi bakiyesini bozar).
-- is_household_member() zaten SECURITY DEFINER, yani policy içinden
-- çağrılması household_members'ın kendi RLS'ine takılmıyor.

drop policy entries_insert_own on public.entries;
create policy entries_insert_own on public.entries
  for insert with check (
    auth.uid() = user_id
    and (
      shared_household_id is null
      or public.is_household_member(shared_household_id)
    )
  );

-- UPDATE'te USING değişmiyor (hangi satırları düzenleyebilirsin: kendininkiler),
-- WITH CHECK sıkılaşıyor (düzenleme SONRASI satır neye benzeyebilir): kendi
-- satırını alıp yabancı bir haneye işaretlemek de aynı saldırı.
drop policy entries_update_own on public.entries;
create policy entries_update_own on public.entries
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      shared_household_id is null
      or public.is_household_member(shared_household_id)
    )
  );
