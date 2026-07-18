-- POST /api/recommendations/stream (the "Yenile" button) is rate-limited to
-- 1/hour per user (docs/phase1-plan.md C). A column on profiles survives
-- serverless restarts, unlike an in-memory limiter.
alter table public.profiles
  add column last_recommendation_refresh_at timestamptz;
