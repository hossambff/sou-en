-- App timestamps are stored to the millisecond, like the JavaScript Dates the app reads them into.
-- Postgres keeps microseconds by default, so a time read back into JS (and truncated) would compare
-- as EARLIER than the stored row: e.g. "is there a placement finished after this one?" would find the
-- placement itself, and her result would never be applied. With timestamptz(3) every value
-- round-trips exactly. Runs after the feature migrations so any new column gets the same treatment.
-- (Better Auth's own tables are left as they are: Better Auth writes JS Dates there anyway.)
do $$
declare
  col record;
begin
  for col in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type = 'timestamp with time zone'
       and coalesce(c.datetime_precision, 6) > 3
       and c.table_name not in ('user', 'session', 'account', 'verification')
  loop
    execute format('alter table public.%I alter column %I type timestamptz(3)', col.table_name, col.column_name);
  end loop;
end $$;
