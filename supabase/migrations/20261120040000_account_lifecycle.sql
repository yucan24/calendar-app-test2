-- Keep four-digit credentials, but never retain or return their plaintext.
drop trigger revoke_changed_profile_sessions on public.profiles;
alter table public.profiles
  add column login_code_hash text,
  add column account_status text not null default 'pending'
    check (account_status in ('pending','invited','active','suspended','review','deleted')),
  add column status_before_suspended text,
  add column email_verified_at timestamptz,
  add column deleted_at timestamptz,
  add column accounting_coach boolean not null default false;
alter table public.profiles disable trigger set_profiles_updated_at;
update public.profiles p set
  login_code_hash = case when login_code is not null then extensions.crypt(login_code, extensions.gen_salt('bf',10)) end,
  login_code = null,
  account_status = case when login_enabled then 'active' else 'review' end,
  accounting_coach = role='admin' or is_coach or exists(select 1 from public.coach_work_logs w where w.coach_id=p.id);
alter table public.profiles enable trigger set_profiles_updated_at;

create table public.app_account_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('setup','reset','admin_reset','manual_setup','manual_reset','verify_email','email_change')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  email text not null,
  previous_email text not null,
  credential_snapshot text,
  status_snapshot text not null,
  expires_at timestamptz not null default now()+interval '30 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.app_account_tokens(profile_id);
create table public.app_account_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  recipient text not null,
  delivery_status text not null check(delivery_status in ('sent','failed','disabled')),
  error_message text,
  created_at timestamptz not null default now()
);
create index on public.app_account_notifications(profile_id,created_at desc);

create function public.prepare_app_profile() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.login_code is not null then
    if new.login_code !~ '^[0-9]{4}$' then raise exception '4桁の数字を入力してください。'; end if;
    new.login_code_hash := extensions.crypt(new.login_code,extensions.gen_salt('bf',10));
    new.login_code := null;
  end if;
  if TG_OP='INSERT' then
    if new.login_enabled and new.account_status='pending' then new.account_status:='active'; end if;
  elsif new.account_status=old.account_status and new.login_enabled is distinct from old.login_enabled then
    new.account_status:=case when new.login_enabled then 'active' else 'suspended' end;
  end if;
  new.login_enabled:=new.account_status='active';
  new.accounting_coach:=new.accounting_coach or new.role='admin';
  if TG_OP='UPDATE' then
    if old.account_status='deleted' and new.account_status<>'deleted' then raise exception '削除済みの会員は再開できません。'; end if;
    new.accounting_coach:=new.accounting_coach or old.accounting_coach;
    if new.email is distinct from old.email and new.email_verified_at is not distinct from old.email_verified_at then
      new.email_verified_at:=null;
    end if;
  end if;
  return new;
end $$;
create trigger prepare_app_profile before insert or update on public.profiles
for each row execute function public.prepare_app_profile();

create or replace function public.revoke_changed_profile_sessions() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if row(old.name,old.login_code_hash,old.login_enabled,old.role,old.group_id,old.email,old.account_status)
    is distinct from row(new.name,new.login_code_hash,new.login_enabled,new.role,new.group_id,new.email,new.account_status) then
    delete from public.app_sessions where profile_id=old.id;
    update public.app_account_tokens set expires_at=least(expires_at,now()) where profile_id=old.id and consumed_at is null;
  end if;
  return new;
end $$;
create trigger revoke_changed_profile_sessions after update on public.profiles
for each row execute function public.revoke_changed_profile_sessions();

create or replace function public.authenticate_app_session(p_name text,p_login_code text,p_token_hash text)
returns table(profile_id uuid,profile_role text,outcome text)
language plpgsql security definer set search_path=public as $$
declare m public.profiles;
begin
  if p_name is null or length(p_name) not between 1 and 100 or p_login_code is null
    or p_login_code !~ '^[0-9]{4}$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid login parameters';
  end if;
  select * into m from public.profiles p where p.name=p_name for update;
  if not found or m.login_code_hash is null or extensions.crypt(p_login_code,m.login_code_hash)<>m.login_code_hash or m.account_status='deleted' then
    return query select null::uuid,null::text,'failed'::text;
  elsif not m.login_enabled or m.account_status<>'active' then
    return query select null::uuid,null::text,'pending'::text;
  else
    delete from public.app_sessions where expires_at<=now();
    insert into public.app_sessions(token_hash,profile_id) values(p_token_hash,m.id);
    return query select m.id,m.role,'authenticated'::text;
  end if;
end $$;

create function public.change_app_account(p_profile_id uuid,p_current_code text,p_name text default null,p_new_code text default null)
returns void language plpgsql security definer set search_path=public as $$
declare m public.profiles;
begin
  select * into m from public.profiles where id=p_profile_id for update;
  if m.id is null or m.account_status<>'active' or m.login_code_hash is null or p_current_code is null
    or p_current_code !~ '^[0-9]{4}$' or extensions.crypt(p_current_code,m.login_code_hash)<>m.login_code_hash then
    raise exception '現在の4桁コードを確認してください。';
  end if;
  if p_name is not null and (length(p_name) not between 1 and 100 or p_name ~ '\s') then raise exception '名前が不正です。'; end if;
  if p_new_code is not null and p_new_code !~ '^[0-9]{4}$' then raise exception '4桁の数字を入力してください。'; end if;
  if (p_name is not null and p_name is distinct from m.name) or p_new_code is not null then
    update public.profiles set name=coalesce(p_name,name),login_code=p_new_code where id=m.id;
  end if;
end $$;

create function public.manage_app_member(p_actor_id uuid,p_member_id uuid,p_action text)
returns table(outcome_status text,outcome_mode text)
language plpgsql security definer set search_path=public as $$
declare a public.profiles; m public.profiles; dependency record; has_history boolean:=false; found_history boolean;
begin
  select * into a from public.profiles where id=p_actor_id;
  if a.id is null then raise exception '権限がありません。'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.group_id::text||':account-management',0));
  select * into a from public.profiles where id=p_actor_id and role='admin' and login_enabled and account_status='active';
  select * into m from public.profiles where id=p_member_id and group_id=a.group_id for update;
  if a.id is null or m.id is null then raise exception 'この会員を操作する権限がありません。'; end if;
  if p_member_id=p_actor_id and p_action in ('suspend','delete','role_user') then raise exception '自分自身の管理権限・利用資格は削除できません。'; end if;
  if m.account_status='deleted' then raise exception '削除済みの会員です。'; end if;
  if m.role='admin' and m.login_enabled and p_action in ('suspend','delete','role_user')
    and not exists(select 1 from public.profiles where group_id=a.group_id and role='admin' and login_enabled and id<>m.id) then
    raise exception '最後の管理者は削除・停止できません。';
  end if;
  if p_action='approve' then
    if m.account_status not in ('pending','review') then raise exception 'この申請は処理済みです。'; end if;
    update public.profiles set account_status=case when login_code_hash is null then 'invited' else 'active' end where id=m.id;
  elsif p_action='suspend' then
    if m.account_status not in ('active','invited') then raise exception '停止できない状態です。'; end if;
    update public.profiles set status_before_suspended=account_status,account_status='suspended' where id=m.id;
  elsif p_action='resume' then
    if m.account_status<>'suspended' then raise exception '停止中の会員ではありません。'; end if;
    update public.profiles set account_status=case when status_before_suspended='invited' then 'invited' else 'active' end,status_before_suspended=null where id=m.id;
  elsif p_action in ('role_admin','role_user') then
    update public.profiles set role=case when p_action='role_admin' then 'admin' else 'user' end where id=m.id;
  elsif p_action='delete' then
    -- Check every business FK, including creator references, under the parent row lock.
    for dependency in select c.conrelid::regclass as relation,att.attname as column_name
      from pg_constraint c join pg_attribute att on att.attrelid=c.conrelid and att.attnum=c.conkey[1]
      where c.contype='f' and c.confrelid='public.profiles'::regclass
        and c.conrelid not in ('public.app_sessions'::regclass,'public.app_account_tokens'::regclass,'public.app_account_notifications'::regclass)
    loop
      execute format('select exists(select 1 from %s where %I=$1)',dependency.relation,dependency.column_name) into found_history using m.id;
      has_history:=has_history or found_history;
    end loop;
    if not has_history then
      delete from public.profiles where id=m.id;
      return query select 'deleted'::text,'permanent'::text; return;
    end if;
    update public.profiles set account_status='deleted',deleted_at=now(),login_code_hash=null,email='',email_verified_at=null where id=m.id;
    delete from public.app_account_tokens where profile_id=m.id;
    delete from public.app_account_notifications where profile_id=m.id;
  else raise exception '操作が不正です。';
  end if;
  return query select p.account_status,case when p_action='delete' then 'history_preserved' else 'updated' end from public.profiles p where p.id=m.id;
end $$;

create function public.issue_app_account_token(p_profile_id uuid,p_purpose text,p_token_hash text,p_email text,p_actor_id uuid default null)
returns table(token_id uuid,member_name text,recipient text)
language plpgsql security definer set search_path=public as $$
declare m public.profiles; a public.profiles; t uuid;
begin
  select * into m from public.profiles where id=p_profile_id for update;
  if m.id is null or m.account_status in ('deleted','suspended','pending','review') then raise exception '現在この会員には発行できません。'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_email is null or length(p_email)>254
    or (p_purpose not in ('manual_setup','manual_reset') and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception '入力が不正です。'; end if;
  select * into a from public.profiles where id=p_actor_id and login_enabled and account_status='active';
  if p_purpose='reset' then
    if m.account_status<>'active' or m.email_verified_at is null or lower(m.email)<>lower(p_email) then raise exception '再設定できません。'; end if;
  elsif p_purpose in ('setup','admin_reset','manual_setup','manual_reset') then
    if a.id is null or a.role<>'admin' or a.group_id<>m.group_id then raise exception '権限がありません。'; end if;
    if p_purpose in ('setup','manual_setup') and m.account_status<>'invited' then raise exception '初期設定の対象ではありません。'; end if;
    if lower(m.email)<>lower(p_email) then raise exception '登録メールと一致しません。'; end if;
  elsif p_purpose in ('verify_email','email_change') then
    if a.id is null or (a.id<>m.id and (a.role<>'admin' or a.group_id<>m.group_id)) then raise exception '権限がありません。'; end if;
    if p_purpose='verify_email' and lower(m.email)<>lower(p_email) then raise exception '登録メールと一致しません。'; end if;
    if m.account_status<>'active' then raise exception '利用中の会員だけが変更できます。'; end if;
  else raise exception 'リンクの種類が不正です。'; end if;
  update public.app_account_tokens set expires_at=least(expires_at,now()) where profile_id=m.id and purpose=p_purpose and consumed_at is null;
  insert into public.app_account_tokens(profile_id,purpose,token_hash,email,previous_email,credential_snapshot,status_snapshot)
    values(m.id,p_purpose,p_token_hash,lower(p_email),lower(m.email),m.login_code_hash,m.account_status) returning id into t;
  return query select t,m.name,lower(p_email);
end $$;

create function public.consume_app_account_token(p_token_hash text,p_new_code text default null)
returns text language plpgsql security definer set search_path=public as $$
declare t public.app_account_tokens; m public.profiles; target_id uuid;
begin
  select profile_id into target_id from public.app_account_tokens where token_hash=p_token_hash;
  select * into m from public.profiles where id=target_id for update;
  select * into t from public.app_account_tokens where token_hash=p_token_hash for update;
  if t.id is null or m.id is null or t.consumed_at is not null or t.expires_at<=now()
    or m.account_status<>t.status_snapshot or lower(m.email)<>t.previous_email
    or m.login_code_hash is distinct from t.credential_snapshot or m.account_status not in ('active','invited') then
    raise exception 'リンクが無効か期限切れです。再発行してください。';
  end if;
  if t.purpose in ('setup','reset','admin_reset','manual_setup','manual_reset') then
    if p_new_code is null or p_new_code !~ '^[0-9]{4}$' then raise exception '4桁の数字を入力してください。'; end if;
    update public.profiles set login_code=p_new_code,email_verified_at=case when t.purpose in ('manual_setup','manual_reset') then email_verified_at else now() end,account_status='active' where id=m.id;
  else
    update public.profiles set email=t.email,email_verified_at=now() where id=m.id;
  end if;
  update public.app_account_tokens set consumed_at=now() where id=t.id;
  return t.purpose;
end $$;

create function public.inspect_app_account_token(p_token_hash text)
returns table(purpose text) language sql security definer set search_path=public as $$
  select t.purpose from public.app_account_tokens t join public.profiles p on p.id=t.profile_id
  where t.token_hash=p_token_hash and t.consumed_at is null and t.expires_at>now()
    and p.account_status=t.status_snapshot and p.account_status in ('active','invited')
    and lower(p.email)=t.previous_email and p.login_code_hash is not distinct from t.credential_snapshot;
$$;

-- Accounting eligibility outlives login privileges and membership.
do $$ declare f record; definition text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('create_coach_reward_adjustment','update_coach_reward_adjustment','match_bank_transaction_virtual_payment','match_bank_transaction_coach_payment','settle_coach_offsets_without_transfer') loop
    definition:=pg_get_functiondef(f.oid);
    definition:=regexp_replace(definition,'and role[[:space:]]*=[[:space:]]*''admin''[[:space:]]+and login_enabled[[:space:]]*=[[:space:]]*true','and accounting_coach = true','g');
    definition:=replace(definition,'and role=''admin'' and login_enabled','and accounting_coach');
    execute definition;
  end loop;
end $$;

alter table public.app_account_tokens enable row level security;
alter table public.app_account_notifications enable row level security;
revoke all on all tables in schema public from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
