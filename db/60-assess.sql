-- Placement test + unit exam extras on top of db/50-learning.sql. Idempotent.

-- Scoring claim: a retry while Hossam is still listening to her speaking must not call Claude (and pay) twice
alter table placement_test add column if not exists scoring_started_at timestamptz;
-- A retake (she had already placed): it only ever moves her forward and blends her skills
alter table placement_test add column if not exists retake boolean not null default false;

-- The exams hub and the retry lock look up her exams per unit
create index if not exists exam_user_unit on exam (user_id, unit_id, finished_at desc);
