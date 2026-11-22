-- Do not guess which financial record to keep if legacy duplicates exist.
do $$
begin
  if exists (
    select 1 from public.billing_items
    where category = 'tuition'
    group by group_id, user_id, target_month having count(*) > 1
  ) then
    raise exception '同一会員・対象月の月謝が重複しています。既存請求を確認してから適用してください。'
      using errcode = '23505';
  end if;
end $$;

create unique index billing_items_tuition_group_user_month_key
  on public.billing_items (group_id, user_id, target_month)
  where category = 'tuition';

create function public.create_monthly_tuition(
  p_admin_id uuid, p_target_month text, p_amount integer, p_note text default ''
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  actor public.profiles;
  created_count integer;
begin
  select * into actor from public.profiles
  where id = p_admin_id and role = 'admin' and login_enabled and account_status = 'active'
  for share;
  if not found then
    raise exception '月謝を作成する権限がありません。' using errcode = '42501';
  end if;
  if p_target_month is null or p_target_month !~ '^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception '対象月が不正です。' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception '金額は0以上の整数で入力してください。' using errcode = '22023';
  end if;

  insert into public.billing_items
    (group_id, user_id, target_month, category, title, amount, status, due_date, note, created_by)
  select actor.group_id, member.id, p_target_month, 'tuition', '月謝', p_amount,
    'unpaid', null, p_note, actor.id
  from public.profiles member
  where member.group_id = actor.group_id and member.role = 'user'
    and member.login_enabled and member.account_status = 'active'
  order by member.id
  on conflict (group_id, user_id, target_month) where category = 'tuition' do nothing;

  get diagnostics created_count = row_count;
  return created_count;
end $$;

revoke all on function public.create_monthly_tuition(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_monthly_tuition(uuid, text, integer, text)
  to service_role;
