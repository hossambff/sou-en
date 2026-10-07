-- Cheer Squad, web push reminders. Idempotent: safe to run on every deploy.

-- Voice (or text) cheers from the squad, played by coach Hossam before Sou's next session.
create table if not exists cheer (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  text not null references "user"(id) on delete cascade,
  to_user_id    text not null references "user"(id) on delete cascade,
  clip_id       uuid references audio_clip(id) on delete set null,
  text          text check (char_length(text) <= 280),
  created_at    timestamptz not null default now(),
  played_at     timestamptz
);
create index if not exists cheer_pending on cheer (to_user_id, created_at) where played_at is null;
create index if not exists cheer_sent on cheer (from_user_id, created_at desc);

-- One row per browser/device that allowed notifications.
create table if not exists push_subscription (
  endpoint    text primary key,
  user_id     text not null references "user"(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscription_user on push_subscription (user_id);
-- Last time the owner's browser confirmed this subscription: the per-user cap drops the stalest first.
alter table push_subscription add column if not exists updated_at timestamptz not null default now();

-- At most one notification of each kind per person per (local) day.
create table if not exists notification_log (
  user_id  text not null references "user"(id) on delete cascade,
  day      date not null,
  kind     text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, day, kind)
);

alter table cheer             enable row level security;
alter table push_subscription enable row level security;
alter table notification_log  enable row level security;
