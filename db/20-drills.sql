-- Drills: Shadow Me (repeat after Hossam) and Say It Back (spoken spaced repetition). Idempotent.
-- Points for a finished drill live in coach_session (activity 'shadow' | 'review'), so stats include drills.

create table if not exists drill_attempt (
  id          bigserial primary key,
  user_id     text not null references "user"(id) on delete cascade,
  kind        text not null check (kind in ('shadow', 'review')),
  target      text not null,
  heard       text,
  -- shadow: 0–100 word match; review: 100 = she said it, 0 = missed / "I don't know"
  score       int not null check (score between 0 and 100),
  -- one drill round (client-generated; also the id of the coach_session row written at the end)
  run_id      uuid,
  created_at  timestamptz not null default now()
);
create index if not exists drill_attempt_user on drill_attempt (user_id, created_at desc);
create index if not exists drill_attempt_run on drill_attempt (run_id) where run_id is not null;

alter table drill_attempt enable row level security;
