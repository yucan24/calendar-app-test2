-- Keep the existing name + four-digit login, but use server-validated opaque sessions.
create table public.app_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  check (expires_at > created_at)
);
create index app_sessions_profile_idx on public.app_sessions(profile_id);
create index app_sessions_expiry_idx on public.app_sessions(expires_at);

create table public.app_auth_rate_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null check (attempts >= 1)
);
create index app_auth_rate_limits_window_idx on public.app_auth_rate_limits(window_started_at);

create function public.consume_auth_rate_limit(p_bucket_hash text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_attempts integer;
begin
  if p_bucket_hash is null or p_bucket_hash !~ '^[a-f0-9]{64}$'
    or p_limit is null or p_limit not between 1 and 1000
    or p_window_seconds is null or p_window_seconds not between 60 and 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;
  delete from public.app_auth_rate_limits where window_started_at < now() - interval '2 days';
  insert into public.app_auth_rate_limits(bucket_hash, attempts)
  values(p_bucket_hash, 1)
  on conflict(bucket_hash) do update set
    attempts = case
      when app_auth_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now() then 1
      else least(app_auth_rate_limits.attempts + 1, p_limit + 1)
    end,
    window_started_at = case
      when app_auth_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now() then now()
      else app_auth_rate_limits.window_started_at
    end
  returning attempts into current_attempts;
  return current_attempts <= p_limit;
end;
$$;

create function public.authenticate_app_session(p_name text, p_login_code text, p_token_hash text)
returns table(profile_id uuid, profile_role text, outcome text)
language plpgsql security definer set search_path = public as $$
declare member public.profiles%rowtype;
begin
  if p_name is null or length(p_name) not between 1 and 100
    or p_login_code is null or p_login_code !~ '^[0-9]{4}$'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid login parameters';
  end if;
  select p.* into member from public.profiles p
  where p.name = p_name and p.login_code = p_login_code for update;
  if not found then
    return query select null::uuid, null::text, 'failed'::text;
  elsif not member.login_enabled then
    return query select null::uuid, null::text, 'pending'::text;
  else
    delete from public.app_sessions where expires_at <= now();
    insert into public.app_sessions(token_hash, profile_id) values(p_token_hash, member.id);
    return query select member.id, member.role, 'authenticated'::text;
  end if;
end;
$$;

create function public.get_app_session_profile(p_token_hash text)
returns table(id uuid, group_id uuid, role text, name text, email text)
language sql security definer set search_path = public as $$
  select p.id, p.group_id, p.role, p.name, p.email
  from public.app_sessions s join public.profiles p on p.id = s.profile_id
  where s.token_hash = p_token_hash and s.expires_at > now() and p.login_enabled;
$$;

create function public.revoke_changed_profile_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if row(old.name, old.login_code, old.login_enabled, old.role, old.group_id)
    is distinct from row(new.name, new.login_code, new.login_enabled, new.role, new.group_id) then
    delete from public.app_sessions where profile_id = old.id;
  end if;
  return new;
end;
$$;
create trigger revoke_changed_profile_sessions
after update on public.profiles for each row execute function public.revoke_changed_profile_sessions();

-- Keep offset protections for direct server writes; managed SECURITY DEFINER RPCs
-- still perform their controlled updates as the function owner.
create or replace function public.protect_coach_payment_offset()
returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP = 'INSERT' then
   if (NEW.coach_payment_transaction_id is not null or NEW.coach_payment_offset_month is not null) and current_user in ('anon','authenticated','service_role') then
     raise exception '請求相殺は指導者支払いの照合から実行してください' using errcode='42501';
   end if;
   return NEW;
 end if;
 if OLD.coach_payment_transaction_id is not null or OLD.coach_payment_offset_month is not null then
   if TG_OP = 'DELETE' or current_user in ('anon','authenticated','service_role') then
     raise exception '報酬で相殺済みの請求です。先に銀行照合を取り消してください' using errcode='22023';
   end if;
   if (NEW.coach_payment_transaction_id is not null or NEW.coach_payment_offset_month is not null) and row(NEW.amount, NEW.user_id, NEW.target_month,
     NEW.category, NEW.title, NEW.status) is distinct from row(OLD.amount, OLD.user_id, OLD.target_month,
     OLD.category, OLD.title, OLD.status) then
     raise exception '報酬で相殺済みの請求です。先に銀行照合を取り消してください' using errcode='22023';
   end if;
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end;
$$;

-- All database access now happens on the server, after verifying the session and team.
-- Public clients must not read profiles, change attendance, or invoke admin RPCs.
do $server_access$
declare relation record;
begin
  for relation in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', relation.tablename);
  end loop;
end;
$server_access$;
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
