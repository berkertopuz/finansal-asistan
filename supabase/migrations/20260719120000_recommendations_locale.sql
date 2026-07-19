-- Bilingual recommendation output (CLAUDE.md rule 1 update, 2026-07-19):
-- the LLM now writes its rationale directly in the target user's selected
-- language instead of always Turkish, so body_tr's name no longer fits and
-- a locale column is needed to know which language a given row is in
-- (existing rows are all Turkish, new rows can be either).
alter table public.recommendations rename column body_tr to body;
alter table public.recommendations add column locale text not null default 'tr' check (locale in ('tr', 'en'));
