create or replace function public.list_accounting_income_items_until(
  p_admin_profile_id uuid,
  p_target_month text
)
returns table (
  id uuid,
  received_on date,
  payer_name text,
  category text,
  title text,
  amount integer,
  note text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  month_start date;
  month_end date;
begin
  if p_target_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'invalid target month' using errcode = '22023';
  end if;

  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  month_start := to_date(p_target_month || '-01', 'YYYY-MM-DD');
  month_end := month_start + interval '1 month';

  return query
  select
    item.id,
    item.received_on,
    item.payer_name,
    item.category,
    item.title,
    item.amount,
    item.note
  from public.accounting_income_items as item
  where item.group_id = admin_profile.group_id
    and item.received_on < month_end
  order by item.received_on desc, item.created_at desc;
end;
$$;

grant execute on function public.list_accounting_income_items_until(uuid, text)
to anon, authenticated;
