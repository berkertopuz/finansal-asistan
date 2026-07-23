-- Bug: deleting a single materialized occurrence of a recurring template
-- (from Defter's "Tümü" table) came back on the next page load. Root cause:
-- materializeDueOccurrences (src/lib/recurrence-materialize.ts) unconditionally
-- upserts every due (template_id, occurred_at) pair for the current month on
-- every navigation — once the row is deleted, that slot looks "not yet
-- generated" again and gets regenerated. Deleting the whole template
-- ("Tüm kayıtları sil") already worked, since there's no template left to
-- regenerate from; only single-occurrence deletes were affected.
--
-- skip_dates records occurrences the user explicitly deleted for a given
-- template — materialize excludes these from what it (re)generates. Only
-- meaningful on template rows (recurrence <> 'none'); concrete/materialized
-- rows never read or write their own skip_dates.
alter table public.entries
  add column skip_dates date[] not null default '{}';
