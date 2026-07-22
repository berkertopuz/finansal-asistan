-- 1. categories — a user's own, persistent, reusable tag list (eğlence,
-- alkol, sigara, ...) alongside the built-in preset chips in
-- src/lib/ledger.ts's ENTRY_CATEGORIES. entries.category has always been
-- free text (no enum, no FK) — this table is purely the picker's source
-- list, deliberately not referenced by entries.category via FK, so deleting
-- a tag here never retroactively breaks or orphans a historical entry
-- (categoryLabel() in src/lib/ledger.ts already falls back to rendering an
-- unknown category value verbatim).
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) > 0 and char_length(name) <= 50),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index categories_user_idx on public.categories (user_id);

alter table public.categories enable row level security;

create policy categories_select_own on public.categories
  for select using (auth.uid() = user_id);
create policy categories_insert_own on public.categories
  for insert with check (auth.uid() = user_id);
create policy categories_delete_own on public.categories
  for delete using (auth.uid() = user_id);

-- 2. Taksit (installment): a fixed-length series of monthly expense rows,
-- all generated eagerly at once when the purchase is recorded — structurally
-- different from recurrence/template_id (src/lib/recurrence-materialize.ts),
-- which models an open-ended rule lazily materialized one month at a time.
-- A taksit plan's total and count are both known up front, so there's
-- nothing to lazily generate: every future month's row already exists the
-- moment the purchase is entered, which is what lets the app show "kalan
-- taksit borcu" by simply summing not-yet-occurred rows in the group.
alter table public.entries
  add column installment_group_id uuid,
  add column installment_index    smallint,
  add column installment_count    smallint;

-- All three null together, or all three set together with a sane index/count.
alter table public.entries
  add constraint entries_installment_fields_consistent
    check (
      (installment_group_id is null and installment_index is null and installment_count is null)
      or (
        installment_group_id is not null
        and installment_count >= 2
        and installment_index between 1 and installment_count
      )
    );

-- A taksit row is always a concrete expense — never a recurring template
-- (recurrence must be 'none') and never itself generated from one
-- (template_id must be null). Mirrors the entries_investment_requires_position
-- pattern in 20260721120000_investment_kind_and_manual_asset.sql.
alter table public.entries
  add constraint entries_installment_requires_expense_and_concrete
    check (
      installment_group_id is null
      or (kind = 'expense' and recurrence = 'none' and template_id is null)
    );

create index entries_installment_group_idx
  on public.entries (installment_group_id)
  where installment_group_id is not null;
