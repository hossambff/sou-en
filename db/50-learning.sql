-- v3: placement test, level + curriculum units, exams, homework, pronunciation. Idempotent.

-- Her level profile (set by the placement test, updated by exams)
alter table learner_profile add column if not exists skill_scores jsonb not null default '{}';
alter table learner_profile add column if not exists current_unit text;
alter table learner_profile add column if not exists placement_status text not null default 'pending';
alter table learner_profile add column if not exists placement_at timestamptz;
do $$ begin
  alter table learner_profile add constraint learner_profile_placement_status_check
    check (placement_status in ('pending', 'skipped', 'done'));
exception when duplicate_object then null; end $$;

-- More kinds of recordings
alter table audio_clip drop constraint if exists audio_clip_kind_check;
alter table audio_clip add constraint audio_clip_kind_check
  check (kind in ('checkup', 'cheer', 'placement', 'exam', 'homework', 'pronunciation'));

-- Placement test: one row per attempt. answers = what she did per item; result = the level verdict.
create table if not exists placement_test (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references "user"(id) on delete cascade,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'in_progress' check (status in ('in_progress', 'pending', 'scored')),
  answers      jsonb not null default '[]',
  result       jsonb,
  cefr         text
);
create index if not exists placement_test_user on placement_test (user_id, started_at desc);

-- Curriculum progress, one row per unit she has started
create table if not exists unit_progress (
  user_id     text not null references "user"(id) on delete cascade,
  unit_id     text not null,
  status      text not null default 'active' check (status in ('active', 'passed')),
  mastery     int not null default 0 check (mastery between 0 and 100),
  started_at  timestamptz not null default now(),
  passed_at   timestamptz,
  primary key (user_id, unit_id)
);

-- Exams: unit exams (pass to move on) and level exams
create table if not exists exam (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references "user"(id) on delete cascade,
  kind         text not null check (kind in ('unit', 'level')),
  unit_id      text,
  level        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'in_progress' check (status in ('in_progress', 'pending', 'scored')),
  tasks        jsonb not null default '[]',
  answers      jsonb not null default '[]',
  score        int check (score between 0 and 100),
  passed       boolean,
  feedback     jsonb,
  scoring_started_at timestamptz
);
create index if not exists exam_user on exam (user_id, started_at desc);

-- Homework: small assignments between sessions, reviewed by Hossam
create table if not exists homework (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references "user"(id) on delete cascade,
  unit_id        text,
  kind           text not null check (kind in ('speak', 'shadow', 'words', 'mission')),
  title          text not null,
  title_ar       text,
  instructions   text not null,
  instructions_ar text,
  payload        jsonb not null default '{}',
  due_on         date not null,
  status         text not null default 'assigned' check (status in ('assigned', 'submitted', 'reviewed', 'skipped')),
  created_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  submission     jsonb,
  feedback       jsonb,
  score          int check (score between 0 and 100),
  points         int not null default 0,
  source_session uuid
);
create index if not exists homework_user on homework (user_id, status, due_on);

-- Pronunciation attempts (drills, homework, the lab): per-word and per-sound results
create table if not exists pronunciation_attempt (
  id          bigserial primary key,
  user_id     text not null references "user"(id) on delete cascade,
  source      text not null,
  target      text not null,
  heard       text,
  engine      text not null check (engine in ('azure', 'basic')),
  score       int check (score between 0 and 100),
  words       jsonb not null default '[]',
  sounds      text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists pronunciation_attempt_user on pronunciation_attempt (user_id, created_at desc);
