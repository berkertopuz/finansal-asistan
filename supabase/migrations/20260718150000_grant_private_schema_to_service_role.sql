-- Section 1 created the `private` schema (helper functions + triggers) but
-- never granted USAGE on it. Postgres schemas aren't usable by a role just
-- because the role can bypass RLS — those are separate privilege systems.
-- Result, only surfaced now while testing the real Edge Functions: every
-- INSERT into market_snapshots fired the market_snapshots_after_insert
-- trigger, which tried to call private.trigger_detect_events() as the
-- inserting role (service_role) and failed with "permission denied for
-- schema private", rolling back the whole insert.

grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- So functions added to `private` later don't silently repeat this bug.
alter default privileges in schema private grant execute on functions to service_role;
