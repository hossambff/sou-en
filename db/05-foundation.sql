-- Foundation for v2 features. Idempotent.

-- Who is who in the family: the learner (Sou) and cheerleaders (e.g. her husband).
create table if not exists app_member (
  user_id     text primary key references "user"(id) on delete cascade,
  role        text not null check (role in ('learner', 'partner')),
  first_name  text not null,
  created_at  timestamptz not null default now()
);

-- Learner settings
alter table learner_profile add column if not exists voice_id text;
alter table learner_profile add column if not exists speech_rate real not null default 0.95;
alter table learner_profile add column if not exists timezone text not null default 'Africa/Casablanca';
alter table learner_profile add column if not exists reminder_hour int check (reminder_hour between 0 and 23);
alter table learner_profile add column if not exists default_minutes int not null default 5;

-- What kind of session it was
alter table coach_session add column if not exists activity text not null default 'chat';
alter table coach_session add column if not exists scenario text;

-- Audio clips (check-up recordings, cheers). Small opus/mp4 files, stored in Postgres.
create table if not exists audio_clip (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null references "user"(id) on delete cascade,
  kind              text not null check (kind in ('checkup', 'cheer')),
  mime              text not null,
  data              bytea not null,
  duration_seconds  real,
  created_at        timestamptz not null default now()
);
create index if not exists audio_clip_user on audio_clip (user_id, created_at desc);

-- Server voice cache: same text + voice + model => reuse audio, save quota.
create table if not exists tts_cache (
  key         text primary key,
  mime        text not null,
  data        bytea not null,
  chars       int not null,
  created_at  timestamptz not null default now()
);

-- Daily usage counters for cost guards (tts_chars, llm_calls, stt_seconds)
create table if not exists usage_counter (
  day     date not null,
  kind    text not null,
  amount  bigint not null default 0,
  primary key (day, kind)
);

alter table app_member    enable row level security;
alter table audio_clip    enable row level security;
alter table tts_cache     enable row level security;
alter table usage_counter enable row level security;

-- Learners created before roles existed
insert into app_member (user_id, role, first_name)
select user_id, 'learner', first_name from learner_profile
on conflict (user_id) do nothing;
