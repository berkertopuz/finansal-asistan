-- Kart–grup bağı ve satıcı kuralları KALDIRILDI.
--
-- İkisi de aynı fikrin parçasıydı: ekstre satırlarını gruba OTOMATİK
-- ön-işaretlemek (kart bazında ya da satıcı adına göre). Kullanıcı o fikri
-- reddetti ve modeli sadeleştirdi: "kullanıcı giderlerini/ekstresini her
-- zaman olduğu gibi girer; bazılarına bir grup atamak isterse ekrandan
-- seçer."
--
-- Karar doğru, çünkü ön-işaretlemenin tamamı bir TAHMİN katmanıydı ve
-- tahminin doğruluk tavanı zaten düşüktü: bir kartın "ev kartı" olması o
-- kartla yapılan HER harcamanın gruba ait olduğu anlamına gelmiyor, satıcı
-- adı da hangi grubun kastedildiğini söyleyemiyor (aynı market hem ev hem
-- tatil olabilir). Yanlış ön-işaretlemenin bedeli ise asimetrik: paylaşılan
-- bir grupta yanlışlıkla işaretlenen bir harcama karşı tarafın ekranına
-- düşer ve geri alınamaz (gördü). Bu koşullarda tahmin katmanının kazandırdığı
-- birkaç dokunuş, taşıdığı riski ve karmaşıklığı karşılamıyor.
--
-- credit_cards.default_group_id: 20260826150000'de eklenmişti, tek bir gün
-- yaşadı, hiç gerçek veri taşımadı.
--
-- group_merchant_rules: 20260825120000'den beri duruyordu ama HİÇ
-- yazılmadı — arayüzü Faz 4'te yapılacaktı. Boş ve artık amaçsız bir tabloyu
-- bırakmak, sonraki oturumda "bu canlı mı?" sorusu doğurur (counterpart_share
-- ile aynı gerekçe).

drop table public.group_merchant_rules;

-- Policy'ler bu kolona baktığı için önce onlar sadeleşiyor: geriye
-- 20260825120000 öncesindeki hâl kalıyor — "satır senin mi".
drop policy credit_cards_insert_own on public.credit_cards;
create policy credit_cards_insert_own on public.credit_cards
  for insert with check (auth.uid() = user_id);

drop policy credit_cards_update_own on public.credit_cards;
create policy credit_cards_update_own on public.credit_cards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.credit_cards
  drop column default_group_id;
