-- One id per turn she speaks, so a retry after an error can never save the same turn twice
-- (and a genuinely repeated "Yes." is still saved). Idempotent.
alter table coach_message add column if not exists client_turn_id text;
create unique index if not exists coach_message_client_turn
  on coach_message (session_id, client_turn_id) where client_turn_id is not null;
