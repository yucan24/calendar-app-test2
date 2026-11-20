-- Server-only access configuration for production and test environments.
-- Migration 20261120030000 includes these restrictions. Reapply them in the same
-- transaction after future migrations that grant permissions to public clients.
do $production_rls$
declare relation record;
begin
  for relation in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', relation.tablename);
  end loop;
end;
$production_rls$;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
