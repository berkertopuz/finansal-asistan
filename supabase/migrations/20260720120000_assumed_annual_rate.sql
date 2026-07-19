-- The cash-flow timeline's "float gain" estimate (paying a bill on its due
-- date instead of immediately keeps the cash earning interest in between)
-- needs an assumed annual rate to do that math. Seeded with a placeholder;
-- the app overwrites it with a live TCMB EVDS value (TP.TRY.MT01, 1-month TL
-- deposit weighted average) the first time it's rendered, then it becomes a
-- user-editable "rate to calculate with" rather than a fixed default.
alter table public.profiles add column assumed_annual_rate numeric(5,2) not null default 45.00;
