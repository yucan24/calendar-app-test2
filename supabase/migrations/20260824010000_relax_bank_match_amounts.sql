alter table public.bank_transaction_matches
add column if not exists expected_amount integer;

alter table public.bank_transaction_matches
drop constraint if exists bank_transaction_matches_expected_amount_check;

alter table public.bank_transaction_matches
add constraint bank_transaction_matches_expected_amount_check
check (expected_amount is null or expected_amount > 0);

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

create or replace function public.match_bank_transaction_billing_items(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
  p_billing_item_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  bank_transaction record;
  billing_item record;
  item_count integer;
  transaction_direction text;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_billing_item_ids is null or cardinality(p_billing_item_ids) = 0 then
    raise exception 'billing items are required' using errcode = '22023';
  end if;

  if cardinality(p_billing_item_ids) <> (
    select count(distinct item_id) from unnest(p_billing_item_ids) as item_id
  ) then
    raise exception 'duplicate billing items' using errcode = '22023';
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

  select count(*)
  into item_count
  from public.billing_items
  where id = any(p_billing_item_ids)
    and group_id = admin_profile.group_id
    and status = 'unpaid'
    and amount > 0
    and (
      (transaction_direction = 'deposit' and title <> '返金')
      or (transaction_direction = 'withdrawal' and title = '返金')
    );

  if item_count <> cardinality(p_billing_item_ids) then
    raise exception 'invalid billing item selection' using errcode = '22023';
  end if;

  for billing_item in
    select id, user_id, amount
    from public.billing_items
    where id = any(p_billing_item_ids)
      and group_id = admin_profile.group_id
  loop
    insert into public.bank_transaction_matches (
      group_id,
      transaction_id,
      direction,
      match_type,
      target_id,
      profile_id,
      amount,
      created_by
    ) values (
      admin_profile.group_id,
      bank_transaction.id,
      transaction_direction,
      'billing_item',
      billing_item.id,
      billing_item.user_id,
      billing_item.amount,
      admin_profile.id
    );
  end loop;

  update public.billing_items
  set
    status = 'paid',
    paid_at = bank_transaction.transacted_on::timestamptz,
    updated_at = now()
  where id = any(p_billing_item_ids)
    and group_id = admin_profile.group_id;

  update public.bank_transactions
  set status = 'matched', memo = null, updated_at = now()
  where id = bank_transaction.id;
end;
$$;

create or replace function public.match_bank_transaction_virtual_payment(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
  p_match_type text,
  p_profile_id uuid,
  p_target_month text,
  p_expected_amount integer,
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
  match_id uuid;
  built_target_key text;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_match_type not in ('coach_net_pay', 'tax_payment') then
    raise exception 'invalid match type' using errcode = '22023';
  end if;

  if p_target_month is null or p_target_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'invalid target month' using errcode = '22023';
  end if;

  if p_expected_amount is null or p_expected_amount <= 0 then
    raise exception 'invalid expected amount' using errcode = '22023';
  end if;

  if p_match_type = 'coach_net_pay' then
    if not exists (
      select 1
      from public.profiles
      where id = p_profile_id
        and group_id = admin_profile.group_id
        and role = 'admin'
        and login_enabled = true
    ) then
      raise exception 'coach not found' using errcode = '02000';
    end if;

    built_target_key := 'coach_net_pay:' || p_target_month || ':' || p_profile_id;
  else
    built_target_key := 'tax_payment:' || p_target_month;
  end if;

  select * into bank_transaction
  from public.bank_transactions
  where id = p_transaction_id
    and group_id = admin_profile.group_id
  for update;

  if bank_transaction.id is null then
    raise exception 'transaction not found' using errcode = '02000';
  end if;

  if bank_transaction.status <> 'unmatched'
    or bank_transaction.withdrawal_amount <= 0
  then
    raise exception 'transaction is not an unmatched withdrawal'
      using errcode = '22023';
  end if;

  insert into public.bank_transaction_matches (
    group_id,
    transaction_id,
    direction,
    match_type,
    target_key,
    profile_id,
    target_month,
    amount,
    expected_amount,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    bank_transaction.id,
    'withdrawal',
    p_match_type,
    built_target_key,
    case when p_match_type = 'coach_net_pay' then p_profile_id else null end,
    p_target_month,
    bank_transaction.withdrawal_amount,
    p_expected_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id
  )
  returning id into match_id;

  update public.bank_transactions
  set status = 'matched', memo = null, updated_at = now()
  where id = bank_transaction.id;

  return match_id;
end;
$$;

revoke all on function public.list_bank_transactions(uuid, text, date, date) from public;
revoke all on function public.match_bank_transaction_billing_items(uuid, uuid, uuid[]) from public;
revoke all on function public.match_bank_transaction_virtual_payment(uuid, uuid, text, uuid, text, integer, text) from public;

grant execute on function public.list_bank_transactions(uuid, text, date, date) to anon, authenticated;
grant execute on function public.match_bank_transaction_billing_items(uuid, uuid, uuid[]) to anon, authenticated;
grant execute on function public.match_bank_transaction_virtual_payment(uuid, uuid, text, uuid, text, integer, text) to anon, authenticated;
