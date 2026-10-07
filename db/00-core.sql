-- Sou Coach app tables. Auth tables ("user", "session", ...) are created by Better Auth.
-- Idempotent: safe to run on every deploy.

create table if not exists learner_profile (
  user_id         text primary key references "user"(id) on delete cascade,
  first_name      text not null,
  baby_name       text,
  baby_birthdate  date,
  why_english     text,
  darija_script   text not null default 'arabic' check (darija_script in ('arabic', 'latin')),
  started_on      date not null default current_date,
  cefr_level      text not null default 'A1',
  created_at      timestamptz not null default now()
);

create table if not exists coach_session (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null references "user"(id) on delete cascade,
  mode              text not null default 'normal' check (mode in ('normal', 'whisper', 'night')),
  minutes_planned   int not null default 5,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  speaking_seconds  int not null default 0,
  points            int not null default 0,
  summary           text,
  golden_fixes      jsonb not null default '[]',
  mood              text check (mood in ('tired', 'ok', 'great'))
);
create index if not exists coach_session_user_started on coach_session (user_id, started_at desc);

create table if not exists coach_message (
  id          bigserial primary key,
  session_id  uuid not null references coach_session(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists coach_message_session on coach_message (session_id, id);

-- Words and chunks, scheduled with FSRS (ts-fsrs card stored as jsonb)
create table if not exists vocab_item (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references "user"(id) on delete cascade,
  term            text not null,
  meaning         text not null,
  example         text,
  card            jsonb not null,
  due             timestamptz not null default now(),
  times_produced  int not null default 0,
  created_at      timestamptz not null default now(),
  unique (user_id, term)
);
create index if not exists vocab_item_due on vocab_item (user_id, due);

create table if not exists error_log (
  id          bigserial primary key,
  user_id     text not null references "user"(id) on delete cascade,
  session_id  uuid references coach_session(id) on delete set null,
  original    text not null,
  corrected   text not null,
  category    text not null,
  created_at  timestamptz not null default now()
);
create index if not exists error_log_user on error_log (user_id, created_at desc);

-- Things the coach remembers about Sou's life
create table if not exists coach_memory (
  id          bigserial primary key,
  user_id     text not null references "user"(id) on delete cascade,
  fact        text not null,
  created_at  timestamptz not null default now()
);

-- The server talks to Postgres directly; block the public Supabase Data API.
alter table learner_profile enable row level security;
alter table coach_session  enable row level security;
alter table coach_message  enable row level security;
alter table vocab_item     enable row level security;
alter table error_log      enable row level security;
alter table coach_memory   enable row level security;
