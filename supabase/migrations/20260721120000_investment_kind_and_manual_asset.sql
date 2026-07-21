-- Lets the user record that this month's cash went into an investment
-- (BIST/altın/kripto/döviz, or an untracked one like land/a house) instead
-- of forcing it through the ledger as an "expense" — the money isn't
-- spent, it's converted into an asset. A new entries.kind ('investment')
-- is never user-selectable directly (QuickEntryForm's kind toggle and the
-- addEntry/updateEntry zod schema are untouched, still 3-way) — it's only
-- ever created server-side, alongside a portfolio_positions row, when the
-- user marks that purchase as funded from their tracked cash balance.
alter table public.entries
  drop constraint entries_kind_check,
  add constraint entries_kind_check
    check (kind in ('income', 'expense', 'subscription', 'investment'));

-- Links a cash-out entries row to the position it funded. ON DELETE CASCADE
-- (not SET NULL, unlike recurring entries' template_id) is deliberate: a
-- position and its one funding entry together represent a single "I made
-- this purchase" fact, not a recurring series with independent historical
-- instances — deleting the position means the purchase never happened, so
-- its cash-out record shouldn't linger either.
alter table public.entries
  add column portfolio_position_id uuid references public.portfolio_positions(id) on delete cascade;

-- Keeps the two facts locked together: only an 'investment' row may carry
-- this link, and every 'investment' row must carry one — mirrors the
-- template_id constraint pattern used for recurring entries.
alter table public.entries
  add constraint entries_investment_requires_position
    check ((kind = 'investment') = (portfolio_position_id is not null));

-- 'manual' is for anything with no live price (land, a house, ...) — no
-- symbol/quantity/market_snapshots lookup is ever attempted for it (the
-- price-fetching Edge Functions and validate-symbol only branch on the
-- four priced classes already; 'manual' simply never matches any of them),
-- so market_snapshots and recommendations' own asset_class constraints are
-- deliberately left untouched.
alter table public.portfolio_positions
  drop constraint portfolio_positions_asset_class_check,
  add constraint portfolio_positions_asset_class_check
    check (asset_class in ('bist', 'gold', 'crypto', 'fx', 'manual'));
