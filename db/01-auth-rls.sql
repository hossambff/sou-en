-- Better Auth's tables are only for the server (which connects as the table owner).
-- Lock them away from Supabase's public Data API.
alter table "user"       enable row level security;
alter table session      enable row level security;
alter table account      enable row level security;
alter table verification enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table "user", session, account, verification from anon, authenticated;
  end if;
end $$;
