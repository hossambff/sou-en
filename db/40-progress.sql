-- Progress features: monthly check-ups and bedtime stories. Idempotent.

-- Monthly Check-up: 3 recorded answers, scored on a rubric by Claude.
-- status 'pending' = recordings saved but not scored yet (Claude unavailable) — retry from /checkup/<id>.
create table if not exists checkup (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references "user"(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Journey month (1, 2, … — not capped at 6). One check-up per month is "due".
  month       int not null,
  status      text not null default 'pending' check (status in ('pending', 'ready')),
  cefr        text check (cefr in ('A1', 'A2', 'B1', 'B2', 'C1')),
  -- { fluency: { score 1–5, evidence }, vocabulary, grammar, pronunciation, interaction }
  scores      jsonb,
  -- { strengths: string[], focus: string[], message: string, messageAr: string }
  report      jsonb,
  -- [{ prompt: 'intro'|'yesterday'|'future', transcript, clipId, seconds }]
  answers     jsonb not null default '[]'
);
create index if not exists checkup_user_created on checkup (user_id, created_at);

-- Bedtime stories Hossam writes for the baby. body = { sentences: [{ en, ar }], words: [{ term, meaning }] }
create table if not exists story (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references "user"(id) on delete cascade,
  title       text not null,
  body        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists story_user_created on story (user_id, created_at desc);

alter table checkup enable row level security;
alter table story   enable row level security;
