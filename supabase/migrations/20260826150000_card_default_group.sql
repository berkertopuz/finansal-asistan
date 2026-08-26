-- Kart bazında grup varsayılanı.
--
-- 20260825120000'de `credit_cards.shared_by_default boolean` olarak gelmişti
-- ve o zaman doğruydu: tek bir "hane" vardı, soru "bu kart ortak mı" idi.
-- Gruplarla birlikte soru değişti — "bu kart HANGİ gruba varsayılan?" —
-- ve bir boolean bunu söyleyemez. Kolon bir FK'ya dönüşüyor.
--
-- Gerekçe aynı: çoğu çiftte zaten bir "ev kartı" var, çoğu tatilde tek bir
-- kart kullanılıyor. Ekstre inceleme ekranında satırları ön-işaretlemenin
-- EN GÜÇLÜ sinyali bu — satıcı adından çıkarım yapmaya çalışmaktan çok daha
-- güvenilir, çünkü kullanıcının kafasındaki modelle birebir örtüşüyor.
--
-- on delete set null: grup silinirse kart kartsız kalmaz, yalnızca
-- varsayılanı düşer.
--
-- Veri taşımıyoruz: shared_by_default bugüne kadar hiçbir arayüzden
-- ayarlanamıyordu (Faz 4'te yazılacaktı), yani her satırda false. Taşınacak
-- bir bilgi yok.

alter table public.credit_cards
  drop column shared_by_default;

alter table public.credit_cards
  add column default_group_id uuid references public.groups(id) on delete set null;

-- Kullanıcı kendi kartına yalnızca ÜYESİ OLDUĞU bir grubu varsayılan
-- yapabilmeli. entries'teki yazma korumasının (20260825140000) aynı sınıfı:
-- arayüz doğru davransa bile oturumu olan biri PostgREST'e doğrudan PATCH
-- atabilir, o yüzden kontrol policy'de duruyor.
drop policy credit_cards_insert_own on public.credit_cards;
create policy credit_cards_insert_own on public.credit_cards
  for insert with check (
    auth.uid() = user_id
    and (default_group_id is null or public.is_group_member(default_group_id))
  );

drop policy credit_cards_update_own on public.credit_cards;
create policy credit_cards_update_own on public.credit_cards
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (default_group_id is null or public.is_group_member(default_group_id))
  );
