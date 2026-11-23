alter table public.accounting_expense_items
drop constraint if exists accounting_expense_items_category_check;

alter table public.accounting_expense_items
add constraint accounting_expense_items_category_check
check (category in ('event', 'fee', 'other'));

create or replace function public.accounting_expense_title(input_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when input_category = 'event' then '大会・イベント費'
    when input_category = 'fee' then '手数料'
    else 'その他出費'
  end;
$$;

create or replace function public.create_accounting_expense_item(
  p_admin_profile_id uuid,
  p_spent_on date,
  p_payee_name text,
  p_category text,
  p_amount integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  created_id uuid;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_category not in ('event', 'fee', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  if nullif(trim(p_payee_name), '') is null then
    raise exception 'payee name is required' using errcode = '22023';
  end if;

  insert into public.accounting_expense_items (
    group_id,
    spent_on,
    payee_name,
    category,
    title,
    amount,
    note,
    created_by,
    updated_at
  )
  values (
    admin_profile.group_id,
    p_spent_on,
    trim(p_payee_name),
    p_category,
    public.accounting_expense_title(p_category),
    p_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id,
    now()
  )
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.update_accounting_expense_item(
  p_admin_profile_id uuid,
  p_item_id uuid,
  p_spent_on date,
  p_payee_name text,
  p_category text,
  p_amount integer,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_category not in ('event', 'fee', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  if nullif(trim(p_payee_name), '') is null then
    raise exception 'payee name is required' using errcode = '22023';
  end if;

  update public.accounting_expense_items
  set
    spent_on = p_spent_on,
    payee_name = trim(p_payee_name),
    category = p_category,
    title = public.accounting_expense_title(p_category),
    amount = p_amount,
    note = nullif(trim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = p_item_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'expense item not found' using errcode = '02000';
  end if;
end;
$$;
