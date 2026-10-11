-- Homework extras on top of db/50-learning.sql. Idempotent.

-- One key per generated item, so two Home renders at the same moment can't assign the same homework twice:
--   'unit:<unit_id>:<kind>:<n>'  (the n-th item of that kind for the unit)
--   'session:<coach_session id>' (the "say your fixes" item after a conversation)
alter table homework add column if not exists dedupe_key text;
create unique index if not exists homework_dedupe on homework (user_id, dedupe_key) where dedupe_key is not null;

-- Feedback claim: a retry while Hossam is still reviewing must not call Claude (and pay) twice
alter table homework add column if not exists review_started_at timestamptz;
