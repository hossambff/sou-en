-- Defense in depth: every table in public gets row-level security (no policies = no Data API access).
-- The app's server connects as the table owner and is unaffected.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
