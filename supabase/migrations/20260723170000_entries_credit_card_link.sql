-- Bug: a recurring subscription that started life as a card-statement
-- import (src/components/ledger/QuickEntryForm.tsx's "kart harcamalarından
-- abonelik'e çevir" flow) kept using its own draw date (next_due_date's
-- day-of-month) as the cash flow occurrence day for every future month.
-- But a card charge doesn't leave the bank account on the day it's charged
-- — every charge on that card settles together, in one lump sum, on the
-- card's payment_day. credit_card_id records which card (if any) an entry
-- was charged to; materializeDueOccurrences (src/lib/recurrence-materialize.ts)
-- uses it to stamp each newly generated month's row with a computed
-- cash_out_at (that month's occurrence, but on the card's payment_day)
-- instead of leaving cash flow to fall back to the draw date. Null for
-- every entry not tied to a card (manual entries, cash/debit purchases).
alter table public.entries
  add column credit_card_id uuid references public.credit_cards(id) on delete set null;
