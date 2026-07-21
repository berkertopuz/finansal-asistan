-- The partial unique index from the previous migration (`where template_id
-- is not null`) can't be targeted by a plain `ON CONFLICT (template_id,
-- occurred_at)` — Postgres requires the conflict target to repeat the
-- index's WHERE clause, which supabase-js's upsert(..., {onConflict}) has
-- no way to express. Confirmed via a direct PostgREST call: 42P10 "there is
-- no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- A plain (non-partial) unique index works instead without changing any
-- behavior: Postgres treats NULL as distinct from every other NULL in a
-- unique constraint, so rows with template_id IS NULL (every one-off entry,
-- and every template row itself) never conflict with each other regardless
-- of occurred_at — only rows that actually share a real template_id are
-- constrained, which is exactly what materialization needs.
drop index public.entries_template_occurrence_uidx;

create unique index entries_template_occurrence_uidx
  on public.entries (template_id, occurred_at);
