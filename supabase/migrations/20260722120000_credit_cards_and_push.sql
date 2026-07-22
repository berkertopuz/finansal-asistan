-- Kredi kartı ekstresi içe aktarma + ekstre/ödeme günü Web Push hatırlatmaları.

-- 1. credit_cards — hatırlatma takviminin kaynağı. statement_day/payment_day
-- kullanıcı tarafından elle girilir (ilk seferde tahmini olabilir), ilk
-- ekstre yüklendiğinde ayrıştırılan gerçek tarihlerle karşılaştırılıp
-- güncellenmesi önerilir (uygulama katmanında, otomatik üzerine yazılmaz).
create table public.credit_cards (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null check (char_length(trim(name)) > 0 and char_length(name) <= 50),
  last4              text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  statement_day      smallint not null check (statement_day between 1 and 31),
  payment_day        smallint not null check (payment_day between 1 and 31),
  reminders_enabled  boolean not null default true,
  created_at         timestamptz not null default now()
);

create index credit_cards_user_idx on public.credit_cards (user_id);

alter table public.credit_cards enable row level security;

create policy credit_cards_select_own on public.credit_cards
  for select using (auth.uid() = user_id);
create policy credit_cards_insert_own on public.credit_cards
  for insert with check (auth.uid() = user_id);
create policy credit_cards_update_own on public.credit_cards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy credit_cards_delete_own on public.credit_cards
  for delete using (auth.uid() = user_id);

-- 2. push_subscriptions — Web Push abonelikleri, cihaz/tarayıcı başına bir
-- satır (aynı kullanıcı birden fazla cihazdan bildirim alabilir).
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth_key   text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
-- subscribeToPush upsert'i (onConflict: "endpoint") aynı endpoint'in
-- p256dh/auth_key'i değişmiş olarak tekrar gelmesi ihtimaline karşı update
-- yoluna da düşebilir — bu policy olmadan RLS o yolu sessizce reddeder.
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- 3. Ekstre metninin OpenAI'a gönderilmesi için ayrı, spesifik açık rıza
-- zaman damgası (KVKK'nın 18.02.2026 tarihli 2026/347 sayılı ilke kararı —
-- açık rıza genel kullanım şartlarına gömülemez, ayrı bir onay olmalı).
-- null = kullanıcı henüz onay vermemiş, ilk ekstre yükleme denemesinde
-- aydınlatma metni + onay adımı gösterilir.
alter table public.profiles
  add column statement_llm_consent_at timestamptz;

-- 4. Günlük hatırlatma taraması — send-card-reminders edge function'ı
-- bugünün gününe denk gelen statement_day/payment_day'i olan kartları
-- bulup ilgili kullanıcıya push gönderir.
select cron.schedule(
  'send-card-reminders-daily',
  '0 5 * * *', -- 08:00 TRT
  $$select private.invoke_edge_function('send-card-reminders');$$
);
