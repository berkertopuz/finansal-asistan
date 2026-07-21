-- Recurring entries move from "one eternal row projected into every month"
-- to "a template row that generates real, independent per-period rows"
-- (docs: chat 2026-07-20, kira zam/silme bug — editing or deleting the old
-- single row retroactively changed or erased every past month too).
--
-- No existing entries carry any real historical value under the old model
-- (it never stored a real past amount for any month — that was the bug
-- itself), so this ships as a clean slate rather than a fragile conversion
-- of old rows into the new shape.
truncate table public.entries;

-- A concrete (recurrence = 'none') row generated from a recurring template
-- points back at it via template_id. `on delete set null` means stopping a
-- recurring rule (deleting its template row) never touches the rows it
-- already generated — they just lose the back-reference and stay exactly
-- as they were, which is the whole point of this migration.
alter table public.entries
  add column template_id uuid references public.entries(id) on delete set null;

-- A template (recurrence <> 'none') never itself points at another
-- template — template_id only ever marks a *generated* concrete row.
alter table public.entries
  add constraint entries_template_id_only_when_concrete
    check (recurrence = 'none' or template_id is null);

-- Materialization (src/lib/recurrence-materialize.ts) upserts on this pair
-- to stay idempotent — calling it twice for the same due date must never
-- create a duplicate row.
create unique index entries_template_occurrence_uidx
  on public.entries (template_id, occurred_at)
  where template_id is not null;

-- entry_amounts no longer needs to amortize weekly/yearly templates into a
-- monthly figure (case e.recurrence ... end) — every counted row is now a
-- concrete, per-period entry with its own real amount (materialization
-- already expanded a weekly template into ~4-5 real rows a month, and a
-- yearly one into a single row in whichever month it's actually due), so
-- summing occurred_at-in-month rows directly gives the exact figure instead
-- of an approximation.
create or replace view public.v_monthly_surplus
with (security_invoker = true) as
with month_bounds as (
  select
    date_trunc('month', current_date)::date as month_start,
    (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date as month_end
),
entry_amounts as (
  select e.user_id, e.kind, e.amount
  from public.entries e, month_bounds mb
  where e.recurrence = 'none'
    and e.occurred_at between mb.month_start and mb.month_end
),
income as (
  select user_id, sum(amount) as total
  from entry_amounts
  where kind = 'income'
  group by user_id
),
expense as (
  select user_id, sum(amount) as total
  from entry_amounts
  where kind = 'expense'
  group by user_id
),
subscription_cost as (
  select user_id, sum(amount) as total
  from entry_amounts
  where kind = 'subscription'
  group by user_id
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
