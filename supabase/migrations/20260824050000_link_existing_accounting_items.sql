alter table public.bank_transaction_matches
add column if not exists owns_target boolean not null default true;

create or replace function public.list_unlinked_accounting_items(
  p_admin_profile_id uuid
)
returns table (
  item_type text,
  item_id uuid,
  item_date date,
  party_name text,
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
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    'income'::text,
    item.id,
    item.received_on,
    item.payer_name,
    item.category,
    item.title,
    item.amount,
    item.note
  from public.accounting_income_items as item
  where item.group_id = admin_profile.group_id
    and item.amount > 0
    and not exists (
      select 1
      from public.bank_transaction_matches as transaction_match
      where transaction_match.group_id = admin_profile.group_id
        and transaction_match.match_type = 'accounting_income_item'
        and transaction_match.target_id = item.id
    )

  union all

  select
    'expense'::text,
    item.id,
    item.spent_on,
    item.payee_name,
    item.category,
    item.title,
    item.amount,
    item.note
  from public.accounting_expense_items as item
  where item.group_id = admin_profile.group_id
    and item.amount > 0
    and not exists (
      select 1
      from public.bank_transaction_matches as transaction_match
      where transaction_match.group_id = admin_profile.group_id
        and transaction_match.match_type = 'accounting_expense_item'
        and transaction_match.target_id = item.id
    )
  order by item_date desc, item_id;
end;
$$;

create or replace function public.match_bank_transaction_existing_accounting_item(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
  p_item_type text,
  p_item_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  bank_transaction record;
  accounting_item record;
  match_id uuid;
  transaction_direction text;
  transaction_amount integer;
  accounting_match_type text;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_item_type not in ('income', 'expense') then
    raise exception 'invalid accounting item type' using errcode = '22023';
  end if;

  select * into bank_transaction
  from public.bank_transactions
  where id = p_transaction_id
    and group_id = admin_profile.group_id
  for update;

  if bank_transaction.id is null then
    raise exception 'transaction not found' using errcode = '02000';
  end if;

  if bank_transaction.status <> 'unmatched' then
    raise exception 'transaction is already processed' using errcode = '22023';
  end if;

  transaction_direction := case
    when bank_transaction.deposit_amount > 0 then 'deposit'
    else 'withdrawal'
  end;
  transaction_amount := greatest(
    bank_transaction.deposit_amount,
    bank_transaction.withdrawal_amount
  );

  if p_item_type = 'income' then
    if transaction_direction <> 'deposit' then
      raise exception 'accounting item direction does not match transaction'
        using errcode = '22023';
    end if;

    select id, amount into accounting_item
    from public.accounting_income_items
    where id = p_item_id
      and group_id = admin_profile.group_id
      and amount > 0
    for update;

    accounting_match_type := 'accounting_income_item';
  else
    if transaction_direction <> 'withdrawal' then
      raise exception 'accounting item direction does not match transaction'
        using errcode = '22023';
    end if;

    select id, amount into accounting_item
    from public.accounting_expense_items
    where id = p_item_id
      and group_id = admin_profile.group_id
      and amount > 0
    for update;

    accounting_match_type := 'accounting_expense_item';
  end if;

  if accounting_item.id is null then
    raise exception 'accounting item not found' using errcode = '02000';
  end if;

  if exists (
    select 1
    from public.bank_transaction_matches
    where group_id = admin_profile.group_id
      and match_type = accounting_match_type
      and target_id = accounting_item.id
  ) then
    raise exception 'accounting item is already linked' using errcode = '23505';
  end if;

  insert into public.bank_transaction_matches (
    group_id,
    transaction_id,
    direction,
    match_type,
    target_id,
    amount,
    expected_amount,
    note,
    created_by,
    owns_target
  ) values (
    admin_profile.group_id,
    bank_transaction.id,
    transaction_direction,
    accounting_match_type,
    accounting_item.id,
    transaction_amount,
    accounting_item.amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id,
    false
  )
  returning id into match_id;

  update public.bank_transactions
  set status = 'matched', memo = null, updated_at = now()
  where id = bank_transaction.id;

  return match_id;
end;
$$;

create or replace function public.list_bank_transactions(
  p_admin_profile_id uuid,
  p_status text default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  id uuid,
  bank_transaction_id text,
  transacted_on date,
  withdrawal_amount integer,
  deposit_amount integer,
  description text,
  normalized_description text,
  balance integer,
  status text,
  memo text,
  matches jsonb,
  created_at timestamptz
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

  if p_status is not null and p_status not in ('unmatched', 'matched', 'ignored') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  return query
  select
    bank_transaction.id,
    bank_transaction.bank_transaction_id,
    bank_transaction.transacted_on,
    bank_transaction.withdrawal_amount,
    bank_transaction.deposit_amount,
    bank_transaction.description,
    bank_transaction.normalized_description,
    bank_transaction.balance,
    bank_transaction.status,
    bank_transaction.memo,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', transaction_match.id,
            'direction', transaction_match.direction,
            'matchType', transaction_match.match_type,
            'targetId', transaction_match.target_id,
            'targetKey', transaction_match.target_key,
            'profileId', transaction_match.profile_id,
            'targetMonth', transaction_match.target_month,
            'amount', transaction_match.amount,
            'expectedAmount', transaction_match.expected_amount,
            'note', transaction_match.note,
            'ownsTarget', transaction_match.owns_target,
            'createdAt', transaction_match.created_at
          )
          order by transaction_match.created_at asc
        )
        from public.bank_transaction_matches as transaction_match
        where transaction_match.transaction_id = bank_transaction.id
      ),
      '[]'::jsonb
    ) as matches,
    bank_transaction.created_at
  from public.bank_transactions as bank_transaction
  where bank_transaction.group_id = admin_profile.group_id
    and (p_status is null or bank_transaction.status = p_status)
    and (p_from_date is null or bank_transaction.transacted_on >= p_from_date)
    and (p_to_date is null or bank_transaction.transacted_on <= p_to_date)
  order by bank_transaction.transacted_on desc, bank_transaction.bank_transaction_id desc;
end;
$$;

create or replace function public.cancel_bank_transaction_match(
  p_admin_profile_id uuid,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  bank_transaction record;
  transaction_match record;
  transaction_match_count integer;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into bank_transaction
  from public.bank_transactions
  where id = p_transaction_id
    and group_id = admin_profile.group_id
    and status = 'matched'
  for update;

  if bank_transaction.id is null then
    raise exception 'matched transaction not found' using errcode = '02000';
  end if;

  select count(*)
  into transaction_match_count
  from public.bank_transaction_matches
  where transaction_id = bank_transaction.id
    and group_id = admin_profile.group_id;

  if transaction_match_count = 0 then
    raise exception 'transaction match not found' using errcode = '02000';
  end if;

  for transaction_match in
    select id, match_type, target_id, owns_target
    from public.bank_transaction_matches
    where transaction_id = bank_transaction.id
      and group_id = admin_profile.group_id
    for update
  loop
    if transaction_match.match_type = 'billing_item' then
      update public.billing_items
      set
        status = 'unpaid',
        paid_at = null,
        updated_at = now()
      where id = transaction_match.target_id
        and group_id = admin_profile.group_id;
    elsif transaction_match.match_type = 'accounting_income_item'
      and transaction_match.owns_target
    then
      delete from public.accounting_income_items
      where id = transaction_match.target_id
        and group_id = admin_profile.group_id;
    elsif transaction_match.match_type = 'accounting_expense_item'
      and transaction_match.owns_target
    then
      delete from public.accounting_expense_items
      where id = transaction_match.target_id
        and group_id = admin_profile.group_id;
    end if;
  end loop;

  delete from public.bank_transaction_matches
  where transaction_id = bank_transaction.id
    and group_id = admin_profile.group_id;

  update public.bank_transactions
  set status = 'unmatched', memo = null, updated_at = now()
  where id = bank_transaction.id
    and group_id = admin_profile.group_id;
end;
$$;

revoke all on function public.list_unlinked_accounting_items(uuid) from public;
revoke all on function public.match_bank_transaction_existing_accounting_item(uuid, uuid, text, uuid, text) from public;

grant execute on function public.list_unlinked_accounting_items(uuid) to anon, authenticated;
grant execute on function public.match_bank_transaction_existing_accounting_item(uuid, uuid, text, uuid, text) to anon, authenticated;
