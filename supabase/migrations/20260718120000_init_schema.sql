-- Finansal Asistan — Phase 1 / Section 1: schema, RLS, v_monthly_surplus, pg_cron.
-- Reference: docs/phase1-plan.md section A (data model), C (API surface / cron chain).

-- ============================================================================
-- 0. Extensions
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid()
-- pg_cron and pg_net are NOT relocatable — each pins its own schema (cron / net)
-- and errors if you try to force one via "with schema", so it's omitted here.
create extension if not exists pg_cron;
create extension if not exists pg_net;                            -- net.http_post for edge fn invocation

-- Internal helpers live outside the public/api-exposed schema.
create schema if not exists private;

-- Generic updated_at bumper, reused by portfolio_positions.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. Tables
-- ============================================================================

-- profiles — 1:1 with auth.users
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  base_currency text not null default 'TRY',
  locale        text not null default 'tr-TR',
  created_at    timestamptz not null default now()
);

-- entries — the ledger (Engine 1)
create table public.entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('income', 'expense', 'subscription')),
  -- Sign is derived from `kind`, never stored negative — blocks the
  -- "negative expense" surplus-inflation trick (docs/phase1-plan.md E.d).
  amount         numeric(14, 2) not null check (amount > 0),
  currency       text not null default 'TRY' check (currency in ('TRY')),
  category       text,
  description    text,
  recurrence     text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly', 'yearly')),
  next_due_date  date,
  occurred_at    date not null default current_date,
  created_at     timestamptz not null default now(),
  constraint entries_next_due_date_only_when_recurring
    check (recurrence <> 'none' or next_due_date is null)
);

create index entries_user_occurred_idx on public.entries (user_id, occurred_at desc);

-- portfolio_positions
create table public.portfolio_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asset_class   text not null check (asset_class in ('bist', 'gold', 'crypto', 'fx')),
  symbol        text not null,
  quantity      numeric(20, 8) not null check (quantity > 0),
  avg_cost_try  numeric(14, 2) not null check (avg_cost_try >= 0),
  opened_at     date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, asset_class, symbol)
);

create trigger portfolio_positions_set_updated_at
  before update on public.portfolio_positions
  for each row
  execute function private.set_updated_at();

create index portfolio_positions_user_idx on public.portfolio_positions (user_id);

-- market_snapshots — shared, service-role write only
create table public.market_snapshots (
  id          uuid primary key default gen_random_uuid(),
  asset_class text not null check (asset_class in ('bist', 'gold', 'crypto', 'fx')),
  symbol      text not null,
  price       numeric(20, 8) not null,
  currency    text not null check (currency in ('TRY', 'USD')),
  source      text not null check (source in ('binance', 'tcmb', 'binance_cross', 'bist_provider')),
  fetched_at  timestamptz not null default now()
);

create index market_snapshots_latest_idx on public.market_snapshots (asset_class, symbol, fetched_at desc);

-- news_items — shared, service-role write only
create table public.news_items (
  id            uuid primary key default gen_random_uuid(),
  headline      text not null,
  source        text not null,
  url           text,
  published_at  timestamptz not null,
  topics        text[] not null default '{}',
  fetched_at    timestamptz not null default now()
);

create index news_items_published_idx on public.news_items (published_at desc);

-- market_events — qualifying-event log, drives the 24h SLA
create table public.market_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null check (event_type in ('bist100_move', 'usdtry_move', 'rate_decision', 'cpi_print')),
  magnitude     numeric,
  detected_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create index market_events_type_detected_idx on public.market_events (event_type, detected_at desc);

-- recommendations
create table public.recommendations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('buy_suggestion', 'position_signal')),
  asset_class    text not null check (asset_class in ('bist', 'gold', 'crypto', 'fx')),
  symbol         text not null,
  signal         text check (signal in ('al', 'tut', 'sat')),
  confidence     text not null check (confidence in ('T1', 'T2', 'T3')),
  body_tr        text not null,
  -- No citation → row rejected at the app layer before insert; NOT NULL is the DB-level backstop.
  cited_headline text not null,
  cited_url      text,
  snapshot_ids   uuid[] not null default '{}',
  event_id       uuid references public.market_events(id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  constraint recommendations_signal_matches_kind
    check (
      (kind = 'buy_suggestion' and signal is null) or
      (kind = 'position_signal' and signal is not null)
    )
);

create index recommendations_user_created_idx on public.recommendations (user_id, created_at desc);
create index recommendations_event_idx on public.recommendations (event_id);

-- ============================================================================
-- 2. auth.users -> profiles bootstrap
-- ============================================================================
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

-- ============================================================================
-- 3. Row Level Security
-- ============================================================================

-- profiles
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = id);

-- entries
alter table public.entries enable row level security;

create policy entries_select_own on public.entries
  for select using (auth.uid() = user_id);
create policy entries_insert_own on public.entries
  for insert with check (auth.uid() = user_id);
create policy entries_update_own on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy entries_delete_own on public.entries
  for delete using (auth.uid() = user_id);

-- portfolio_positions
alter table public.portfolio_positions enable row level security;

create policy portfolio_positions_select_own on public.portfolio_positions
  for select using (auth.uid() = user_id);
create policy portfolio_positions_insert_own on public.portfolio_positions
  for insert with check (auth.uid() = user_id);
create policy portfolio_positions_update_own on public.portfolio_positions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy portfolio_positions_delete_own on public.portfolio_positions
  for delete using (auth.uid() = user_id);

-- recommendations — clients only ever read/dismiss; writes come from service_role only
alter table public.recommendations enable row level security;

create policy recommendations_select_own on public.recommendations
  for select using (auth.uid() = user_id);
create policy recommendations_delete_own on public.recommendations
  for delete using (auth.uid() = user_id);

-- market_snapshots — shared, read-only to authenticated, no client writes
alter table public.market_snapshots enable row level security;

create policy market_snapshots_read_authenticated on public.market_snapshots
  for select to authenticated using (true);

-- news_items — shared, read-only to authenticated, no client writes
alter table public.news_items enable row level security;

create policy news_items_read_authenticated on public.news_items
  for select to authenticated using (true);

-- market_events — shared, read-only to authenticated, no client writes
alter table public.market_events enable row level security;

create policy market_events_read_authenticated on public.market_events
  for select to authenticated using (true);

-- ============================================================================
-- 4. v_monthly_surplus — computed, never stored (docs/phase1-plan.md A.1)
-- ============================================================================
-- security_invoker so the view is evaluated under the querying user's RLS,
-- not the view owner's — required for the per-user scoping to hold. (T1)
create or replace view public.v_monthly_surplus
with (security_invoker = true) as
with month_bounds as (
  select
    date_trunc('month', current_date)::date as month_start,
    (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date as month_end
),
income as (
  select e.user_id, sum(e.amount) as total
  from public.entries e, month_bounds mb
  where e.kind = 'income'
    and e.occurred_at between mb.month_start and mb.month_end
  group by e.user_id
),
expense as (
  select e.user_id, sum(e.amount) as total
  from public.entries e, month_bounds mb
  where e.kind = 'expense'
    and e.occurred_at between mb.month_start and mb.month_end
  group by e.user_id
),
-- Recurring entries are expanded logically here, not duplicated as rows.
-- monthly: counted once if already active this month.
-- weekly / yearly: amortized into a monthly figure (T2 — approximation, revisit in section 4).
-- none: one-off subscription cost, only if it falls in the current month.
subscription_cost as (
  select
    e.user_id,
    sum(
      case e.recurrence
        when 'monthly' then e.amount
        when 'weekly'  then e.amount * (extract(day from mb.month_end)::numeric / 7)
        when 'yearly'  then e.amount / 12
        else e.amount
      end
    ) as total
  from public.entries e, month_bounds mb
  where e.kind = 'subscription'
    and e.occurred_at <= mb.month_end
    and (e.recurrence <> 'none' or e.occurred_at between mb.month_start and mb.month_end)
  group by e.user_id
)
select
  coalesce(i.user_id, ex.user_id, s.user_id) as user_id,
  coalesce(i.total, 0)  as income_total,
  coalesce(ex.total, 0) as expense_total,
  coalesce(s.total, 0)  as subscription_total,
  coalesce(i.total, 0) - coalesce(ex.total, 0) - coalesce(s.total, 0) as surplus
from income i
full outer join expense ex on ex.user_id = i.user_id
full outer join subscription_cost s on s.user_id = coalesce(i.user_id, ex.user_id);

grant select on public.v_monthly_surplus to authenticated;

-- ============================================================================
-- 5. pg_cron + pg_net — Edge Function scheduling (docs/phase1-plan.md C)
-- ============================================================================
-- Edge Functions themselves (poll-prices, poll-news, detect-events,
-- generate-signals, generate-buy-suggestions) ship in section 5 of the
-- write-up order. This section only wires the scheduling/chaining so the
-- cron jobs and DB triggers exist ahead of time; calls will 404 until the
-- functions are deployed — that's expected, not a bug.
--
-- IMPORTANT: this file is committed to git, so it deliberately contains no
-- secrets. `project_url` and `cron_secret` must be created once, by hand, in
-- the Supabase SQL editor after this migration runs — see the deployment
-- steps provided alongside this migration.

create or replace function private.invoke_edge_function(function_name text, payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project_url text;
  v_cron_secret text;
begin
  select decrypted_secret into v_project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_cron_secret from vault.decrypted_secrets where name = 'cron_secret';

  if v_project_url is null or v_cron_secret is null then
    raise warning 'private.invoke_edge_function: vault secrets "project_url"/"cron_secret" not set yet, skipping call to %', function_name;
    return;
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_cron_secret),
    body := payload
  );
end;
$$;

-- --- Time-based jobs -------------------------------------------------------

-- poll-prices: every 15 min during BIST hours (09:00-18:00 TRT = 06:00-15:00 UTC), weekdays.
select cron.schedule(
  'poll-prices-active-hours',
  '*/15 6-15 * * 1-5',
  $$select private.invoke_edge_function('poll-prices');$$
);

-- poll-prices: every 30 min outside BIST hours on weekdays.
select cron.schedule(
  'poll-prices-off-hours-weekday',
  '*/30 0-5,16-23 * * 1-5',
  $$select private.invoke_edge_function('poll-prices');$$
);

-- poll-prices: every 30 min on weekends (crypto/fx never fully sleep).
select cron.schedule(
  'poll-prices-weekend',
  '*/30 * * * 0,6',
  $$select private.invoke_edge_function('poll-prices');$$
);

-- poll-news: hourly.
select cron.schedule(
  'poll-news-hourly',
  '0 * * * *',
  $$select private.invoke_edge_function('poll-news');$$
);

-- generate-signals: daily 07:00 TRT (04:00 UTC) safety sweep for any
-- market_events still unprocessed near the 24h SLA deadline.
select cron.schedule(
  'generate-signals-daily-safety',
  '0 4 * * *',
  $$select private.invoke_edge_function('generate-signals');$$
);

-- generate-buy-suggestions: daily 08:00 TRT (05:00 UTC).
select cron.schedule(
  'generate-buy-suggestions-daily',
  '0 5 * * *',
  $$select private.invoke_edge_function('generate-buy-suggestions');$$
);

-- --- Event-driven chaining (replaces guesswork cron offsets) ---------------

-- poll-prices inserts a batch of snapshots in one statement per run, so a
-- statement-level trigger fires detect-events exactly once per poll cycle —
-- this is the literal "chained after each poll-prices run" from the plan.
create or replace function private.trigger_detect_events()
returns trigger
language plpgsql
as $$
begin
  perform private.invoke_edge_function('detect-events');
  return null;
end;
$$;

create trigger market_snapshots_after_insert
  after insert on public.market_snapshots
  for each statement
  execute function private.trigger_detect_events();

-- detect-events inserting a market_events row immediately fires
-- generate-signals for that specific event (real-time chain, no cron lag).
create or replace function private.trigger_generate_signals()
returns trigger
language plpgsql
as $$
begin
  perform private.invoke_edge_function('generate-signals', jsonb_build_object('event_id', new.id));
  return new;
end;
$$;

create trigger market_events_after_insert
  after insert on public.market_events
  for each row
  execute function private.trigger_generate_signals();
