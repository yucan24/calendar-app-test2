create or replace function public.list_accounting_bank_links(
  p_admin_profile_id uuid
)
returns table (
  item_type text,
  item_id uuid,
  bank_transaction_id text
)
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

  return query
  select
    case
      when transaction_match.match_type = 'accounting_income_item' then 'income'
      else 'expense'
    end::text,
    transaction_match.target_id,
    bank_transaction.bank_transaction_id
  from public.bank_transaction_matches as transaction_match
  join public.bank_transactions as bank_transaction
    on bank_transaction.id = transaction_match.transaction_id
  where transaction_match.group_id = admin_profile.group_id
    and transaction_match.match_type in (
      'accounting_income_item',
      'accounting_expense_item'
    )
    and transaction_match.target_id is not null
  order by bank_transaction.transacted_on desc;
end;
$$;

create or replace function public.update_accounting_income_item(
  p_admin_profile_id uuid,
  p_item_id uuid,
  p_received_on date,
  p_payer_name text,
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

  if exists (
    select 1
    from public.bank_transaction_matches
    where group_id = admin_profile.group_id
      and match_type = 'accounting_income_item'
      and target_id = p_item_id
  ) then
    raise exception 'bank linked item cannot be edited' using errcode = '22023';
  end if;

  if p_category not in ('sponsorship', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  if nullif(trim(p_payer_name), '') is null then
    raise exception 'payer name is required' using errcode = '22023';
  end if;

  update public.accounting_income_items
  set
    received_on = p_received_on,
    payer_name = trim(p_payer_name),
    category = p_category,
    title = public.accounting_income_title(p_category),
    amount = p_amount,
    note = nullif(trim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = p_item_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'income item not found' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.delete_accounting_income_item(
  p_admin_profile_id uuid,
  p_item_id uuid
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

  if exists (
    select 1
    from public.bank_transaction_matches
    where group_id = admin_profile.group_id
      and match_type = 'accounting_income_item'
      and target_id = p_item_id
  ) then
    raise exception 'bank linked item cannot be deleted' using errcode = '22023';
  end if;

  delete from public.accounting_income_items
  where id = p_item_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'income item not found' using errcode = '02000';
  end if;
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

  if exists (
    select 1
    from public.bank_transaction_matches
    where group_id = admin_profile.group_id
      and match_type = 'accounting_expense_item'
      and target_id = p_item_id
  ) then
    raise exception 'bank linked item cannot be edited' using errcode = '22023';
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

create or replace function public.delete_accounting_expense_item(
  p_admin_profile_id uuid,
  p_item_id uuid
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

  if exists (
    select 1
    from public.bank_transaction_matches
    where group_id = admin_profile.group_id
      and match_type = 'accounting_expense_item'
      and target_id = p_item_id
  ) then
    raise exception 'bank linked item cannot be deleted' using errcode = '22023';
  end if;

  delete from public.accounting_expense_items
  where id = p_item_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'expense item not found' using errcode = '02000';
  end if;
end;
$$;

revoke all on function public.list_accounting_bank_links(uuid) from public;
revoke all on function public.update_accounting_income_item(uuid, uuid, date, text, text, integer, text) from public;
revoke all on function public.delete_accounting_income_item(uuid, uuid) from public;
revoke all on function public.update_accounting_expense_item(uuid, uuid, date, text, text, integer, text) from public;
revoke all on function public.delete_accounting_expense_item(uuid, uuid) from public;

grant execute on function public.list_accounting_bank_links(uuid) to anon, authenticated;
grant execute on function public.update_accounting_income_item(uuid, uuid, date, text, text, integer, text) to anon, authenticated;
grant execute on function public.delete_accounting_income_item(uuid, uuid) to anon, authenticated;
grant execute on function public.update_accounting_expense_item(uuid, uuid, date, text, text, integer, text) to anon, authenticated;
grant execute on function public.delete_accounting_expense_item(uuid, uuid) to anon, authenticated;
