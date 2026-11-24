-- A role change still revokes sessions. An invitation does not encode a role,
-- so keep its original, unused setup link when only the role changes.
create or replace function public.revoke_changed_profile_sessions() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if row(old.name,old.login_code_hash,old.login_enabled,old.role,old.group_id,old.email,old.account_status)
    is distinct from row(new.name,new.login_code_hash,new.login_enabled,new.role,new.group_id,new.email,new.account_status) then
    delete from public.app_sessions where profile_id=old.id;
  end if;

  if row(old.name,old.login_code_hash,old.login_enabled,old.group_id,old.email,old.account_status)
    is distinct from row(new.name,new.login_code_hash,new.login_enabled,new.group_id,new.email,new.account_status) then
    update public.app_account_tokens set expires_at=least(expires_at,now())
      where profile_id=old.id and consumed_at is null;
  elsif old.role is distinct from new.role then
    update public.app_account_tokens set expires_at=least(expires_at,now())
      where profile_id=old.id and consumed_at is null
        and not (
          purpose in ('setup','manual_setup')
          and old.account_status='invited' and new.account_status='invited'
          and old.login_code_hash is null and new.login_code_hash is null
        );
  end if;
  return new;
end $$;

revoke all on function public.revoke_changed_profile_sessions()
  from public, anon, authenticated;
grant execute on function public.revoke_changed_profile_sessions() to service_role;
