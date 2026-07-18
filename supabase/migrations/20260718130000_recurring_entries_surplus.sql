-- Extend v_monthly_surplus so recurrence (weekly/monthly/yearly) applies to
-- income and expense too, not just subscriptions. A salary or rent entered
-- once with recurrence='monthly' now counts every month without the user
-- re-adding it — matches docs/phase1-plan.md A.1 ("recurring entries are
-- expanded logically in the view, not duplicated as rows"), which was only
-- wired up for kind='subscription' in the initial migration.

create or replace view public.v_monthly_surplus
with (security_invoker = true) as
with month_bounds as (
  select
    date_trunc('month', current_date)::date as month_start,
    (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date as month_end
),
-- monthly: counted once if already active this month.
-- weekly / yearly: amortized into a monthly figure (T2 — approximation).
-- none: one-off entry, only counted if it falls in the current month.
entry_amounts as (
  select
    e.user_id,
    e.kind,
    case e.recurrence
      when 'monthly' then e.amount
      when 'weekly'  then e.amount * (extract(day from mb.month_end)::numeric / 7)
      when 'yearly'  then e.amount / 12
      else e.amount
    end as monthly_amount
  from public.entries e, month_bounds mb
  where e.occurred_at <= mb.month_end
    and (e.recurrence <> 'none' or e.occurred_at between mb.month_start and mb.month_end)
),
income as (
  select user_id, sum(monthly_amount) as total
  from entry_amounts
  where kind = 'income'
  group by user_id
),
expense as (
  select user_id, sum(monthly_amount) as total
  from entry_amounts
  where kind = 'expense'
  group by user_id
),
subscription_cost as (
  select user_id, sum(monthly_amount) as total
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
