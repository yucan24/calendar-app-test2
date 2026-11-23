create table if not exists public.profile_payment_aliases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  alias_name text not null,
  normalized_alias_name text not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_payment_aliases_alias_not_empty
    check (length(trim(alias_name)) > 0),
  constraint profile_payment_aliases_normalized_not_empty
    check (length(trim(normalized_alias_name)) > 0),
  constraint profile_payment_aliases_unique
    unique (group_id, profile_id, normalized_alias_name)
);

create index if not exists profile_payment_aliases_group_profile_idx
on public.profile_payment_aliases (group_id, profile_id);

create index if not exists profile_payment_aliases_group_normalized_idx
on public.profile_payment_aliases (group_id, normalized_alias_name);

create table if not exists public.bank_csv_imports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  source_filename text not null default '',
  bank_name text not null default '',
  branch_name text not null default '',
  account_type text not null default '',
  account_number text not null default '',
  period_start date,
  period_end date,
  exported_at text not null default '',
  imported_count integer not null default 0 check (imported_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bank_csv_imports_group_created_idx
on public.bank_csv_imports (group_id, created_at desc);

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  import_id uuid references public.bank_csv_imports(id) on delete set null,
  bank_transaction_id text not null,
  transacted_on date not null,
  withdrawal_amount integer not null default 0 check (withdrawal_amount >= 0),
  deposit_amount integer not null default 0 check (deposit_amount >= 0),
  description text not null default '',
  normalized_description text not null default '',
  balance integer,
  status text not null default 'unmatched'
    check (status in ('unmatched', 'matched', 'ignored')),
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_transactions_id_not_empty
    check (length(trim(bank_transaction_id)) > 0),
  constraint bank_transactions_amount_direction_check check (
    (withdrawal_amount > 0 and deposit_amount = 0)
    or (deposit_amount > 0 and withdrawal_amount = 0)
  ),
  constraint bank_transactions_unique unique (group_id, bank_transaction_id)
);

create index if not exists bank_transactions_group_date_idx
on public.bank_transactions (group_id, transacted_on desc);

create index if not exists bank_transactions_group_status_idx
on public.bank_transactions (group_id, status, transacted_on desc);

create index if not exists bank_transactions_group_normalized_description_idx
on public.bank_transactions (group_id, normalized_description);

create table if not exists public.bank_transaction_matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  direction text not null check (direction in ('deposit', 'withdrawal')),
  match_type text not null check (
    match_type in (
      'billing_item',
      'accounting_income_item',
      'accounting_expense_item',
      'coach_net_pay',
      'tax_payment',
      'manual'
    )
  ),
  target_id uuid,
  target_key text,
  profile_id uuid references public.profiles(id) on delete set null,
  target_month text check (
    target_month is null or target_month ~ '^[0-9]{4}-[0-9]{2}$'
  ),
  amount integer not null check (amount > 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bank_transaction_matches_target_check check (
    target_id is not null or target_key is not null or match_type = 'manual'
  )
);

create index if not exists bank_transaction_matches_group_transaction_idx
on public.bank_transaction_matches (group_id, transaction_id);

create index if not exists bank_transaction_matches_group_target_idx
on public.bank_transaction_matches (group_id, match_type, target_id);

create index if not exists bank_transaction_matches_group_target_key_idx
on public.bank_transaction_matches (group_id, match_type, target_key);

create unique index if not exists bank_transaction_matches_unique_target_id_idx
on public.bank_transaction_matches (group_id, match_type, target_id)
where target_id is not null;

create unique index if not exists bank_transaction_matches_unique_target_key_idx
on public.bank_transaction_matches (group_id, match_type, target_key)
where target_key is not null and match_type in ('coach_net_pay', 'tax_payment');

drop trigger if exists set_profile_payment_aliases_updated_at
on public.profile_payment_aliases;

create trigger set_profile_payment_aliases_updated_at
before update on public.profile_payment_aliases
for each row execute function public.set_updated_at();

drop trigger if exists set_bank_transactions_updated_at
on public.bank_transactions;

create trigger set_bank_transactions_updated_at
before update on public.bank_transactions
for each row execute function public.set_updated_at();

alter table public.profile_payment_aliases enable row level security;
alter table public.bank_csv_imports enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.bank_transaction_matches enable row level security;

revoke all on table public.profile_payment_aliases from anon, authenticated;
revoke all on table public.bank_csv_imports from anon, authenticated;
revoke all on table public.bank_transactions from anon, authenticated;
revoke all on table public.bank_transaction_matches from anon, authenticated;

create or replace function public.list_profile_payment_aliases(
  p_admin_profile_id uuid
)
returns table (
  id uuid,
  profile_id uuid,
  profile_name text,
  alias_name text,
  normalized_alias_name text,
  note text,
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

  return query
  select
    payment_alias.id,
    payment_alias.profile_id,
    profile.name,
    payment_alias.alias_name,
    payment_alias.normalized_alias_name,
    payment_alias.note,
    payment_alias.created_at
  from public.profile_payment_aliases as payment_alias
  join public.profiles as profile on profile.id = payment_alias.profile_id
  where payment_alias.group_id = admin_profile.group_id
  order by profile.name asc, payment_alias.created_at asc;
end;
$$;

create or replace function public.create_profile_payment_alias(
  p_admin_profile_id uuid,
  p_profile_id uuid,
  p_alias_name text,
  p_normalized_alias_name text,
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

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and group_id = admin_profile.group_id
      and role = 'user'
      and login_enabled = true
  ) then
    raise exception 'profile not found' using errcode = '02000';
  end if;

  if nullif(trim(coalesce(p_alias_name, '')), '') is null
    or nullif(trim(coalesce(p_normalized_alias_name, '')), '') is null
  then
    raise exception 'alias is required' using errcode = '22023';
  end if;

  insert into public.profile_payment_aliases (
    group_id,
    profile_id,
    alias_name,
    normalized_alias_name,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    p_profile_id,
    trim(p_alias_name),
    trim(p_normalized_alias_name),
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id
  )
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.update_profile_payment_alias(
  p_admin_profile_id uuid,
  p_alias_id uuid,
  p_alias_name text,
  p_normalized_alias_name text,
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

  if nullif(trim(coalesce(p_alias_name, '')), '') is null
    or nullif(trim(coalesce(p_normalized_alias_name, '')), '') is null
  then
    raise exception 'alias is required' using errcode = '22023';
  end if;

  update public.profile_payment_aliases
  set
    alias_name = trim(p_alias_name),
    normalized_alias_name = trim(p_normalized_alias_name),
    note = nullif(trim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = p_alias_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'alias not found' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.delete_profile_payment_alias(
  p_admin_profile_id uuid,
  p_alias_id uuid
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

  delete from public.profile_payment_aliases
  where id = p_alias_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'alias not found' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.list_bank_csv_imports(
  p_admin_profile_id uuid,
  p_limit integer default 10
)
returns table (
  id uuid,
  source_filename text,
  bank_name text,
  branch_name text,
  account_type text,
  account_number text,
  period_start date,
  period_end date,
  exported_at text,
  imported_count integer,
  skipped_count integer,
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

  return query
  select
    import_row.id,
    import_row.source_filename,
    import_row.bank_name,
    import_row.branch_name,
    import_row.account_type,
    import_row.account_number,
    import_row.period_start,
    import_row.period_end,
    import_row.exported_at,
    import_row.imported_count,
    import_row.skipped_count,
    import_row.created_at
  from public.bank_csv_imports as import_row
  where import_row.group_id = admin_profile.group_id
  order by import_row.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

create or replace function public.import_bank_transactions(
  p_admin_profile_id uuid,
  p_import_meta jsonb,
  p_transactions jsonb
)
returns table (
  import_id uuid,
  imported_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_profile record;
  created_import_id uuid;
  transaction_value jsonb;
  inserted_transaction_id uuid;
  imported_total integer := 0;
  skipped_total integer := 0;
  withdrawal_value integer;
  deposit_value integer;
  balance_value integer;
  transaction_date date;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if jsonb_typeof(p_import_meta) <> 'object'
    or jsonb_typeof(p_transactions) <> 'array'
  then
    raise exception 'invalid import payload' using errcode = '22023';
  end if;

  if jsonb_array_length(p_transactions) = 0
    or jsonb_array_length(p_transactions) > 5000
  then
    raise exception 'invalid transaction count' using errcode = '22023';
  end if;

  insert into public.bank_csv_imports (
    group_id,
    source_filename,
    bank_name,
    branch_name,
    account_type,
    account_number,
    period_start,
    period_end,
    exported_at,
    created_by
  ) values (
    admin_profile.group_id,
    left(coalesce(p_import_meta ->> 'sourceFilename', ''), 255),
    left(coalesce(p_import_meta ->> 'bankName', ''), 255),
    left(coalesce(p_import_meta ->> 'branchName', ''), 255),
    left(coalesce(p_import_meta ->> 'accountType', ''), 100),
    left(coalesce(p_import_meta ->> 'accountNumber', ''), 100),
    nullif(p_import_meta ->> 'periodStart', '')::date,
    nullif(p_import_meta ->> 'periodEnd', '')::date,
    left(coalesce(p_import_meta ->> 'exportedAt', ''), 255),
    admin_profile.id
  )
  returning id into created_import_id;

  for transaction_value in
    select value from jsonb_array_elements(p_transactions)
  loop
    if nullif(trim(coalesce(transaction_value ->> 'bankTransactionId', '')), '') is null then
      raise exception 'transaction id is required' using errcode = '22023';
    end if;

    transaction_date := (transaction_value ->> 'transactedOn')::date;
    withdrawal_value := coalesce((transaction_value ->> 'withdrawalAmount')::integer, 0);
    deposit_value := coalesce((transaction_value ->> 'depositAmount')::integer, 0);
    balance_value := nullif(transaction_value ->> 'balance', '')::integer;

    if withdrawal_value < 0
      or deposit_value < 0
      or not (
        (withdrawal_value > 0 and deposit_value = 0)
        or (deposit_value > 0 and withdrawal_value = 0)
      )
    then
      raise exception 'invalid transaction amount direction' using errcode = '22023';
    end if;

    inserted_transaction_id := null;

    insert into public.bank_transactions (
      group_id,
      import_id,
      bank_transaction_id,
      transacted_on,
      withdrawal_amount,
      deposit_amount,
      description,
      normalized_description,
      balance,
      created_by
    ) values (
      admin_profile.group_id,
      created_import_id,
      trim(transaction_value ->> 'bankTransactionId'),
      transaction_date,
      withdrawal_value,
      deposit_value,
      coalesce(transaction_value ->> 'description', ''),
      coalesce(transaction_value ->> 'normalizedDescription', ''),
      balance_value,
      admin_profile.id
    )
    on conflict (group_id, bank_transaction_id) do nothing
    returning id into inserted_transaction_id;

    if inserted_transaction_id is null then
      skipped_total := skipped_total + 1;
    else
      imported_total := imported_total + 1;
    end if;
  end loop;

  update public.bank_csv_imports
  set
    imported_count = imported_total,
    skipped_count = skipped_total
  where id = created_import_id;

  return query select created_import_id, imported_total, skipped_total;
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
  item_total integer;
  transaction_amount integer;
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
  transaction_amount := greatest(
    bank_transaction.deposit_amount,
    bank_transaction.withdrawal_amount
  );

  select count(*), coalesce(sum(amount), 0)
  into item_count, item_total
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

  if item_total <> transaction_amount then
    raise exception 'billing item total does not match transaction amount'
      using errcode = '22023';
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

create or replace function public.match_bank_transaction_income(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
  p_category text,
  p_payer_name text,
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
  created_item_id uuid;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_category not in ('sponsorship', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_payer_name, '')), '') is null then
    raise exception 'payer name is required' using errcode = '22023';
  end if;

  select * into bank_transaction
  from public.bank_transactions
  where id = p_transaction_id
    and group_id = admin_profile.group_id
  for update;

  if bank_transaction.id is null then
    raise exception 'transaction not found' using errcode = '02000';
  end if;

  if bank_transaction.status <> 'unmatched' or bank_transaction.deposit_amount <= 0 then
    raise exception 'transaction is not an unmatched deposit' using errcode = '22023';
  end if;

  insert into public.accounting_income_items (
    group_id,
    received_on,
    payer_name,
    category,
    title,
    amount,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    bank_transaction.transacted_on,
    trim(p_payer_name),
    p_category,
    public.accounting_income_title(p_category),
    bank_transaction.deposit_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id
  )
  returning id into created_item_id;

  insert into public.bank_transaction_matches (
    group_id,
    transaction_id,
    direction,
    match_type,
    target_id,
    amount,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    bank_transaction.id,
    'deposit',
    'accounting_income_item',
    created_item_id,
    bank_transaction.deposit_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id
  );

  update public.bank_transactions
  set status = 'matched', memo = null, updated_at = now()
  where id = bank_transaction.id;

  return created_item_id;
end;
$$;

create or replace function public.match_bank_transaction_expense(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
  p_category text,
  p_payee_name text,
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
  created_item_id uuid;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_category not in ('event', 'fee', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_payee_name, '')), '') is null then
    raise exception 'payee name is required' using errcode = '22023';
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

  insert into public.accounting_expense_items (
    group_id,
    spent_on,
    payee_name,
    category,
    title,
    amount,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    bank_transaction.transacted_on,
    trim(p_payee_name),
    p_category,
    public.accounting_expense_title(p_category),
    bank_transaction.withdrawal_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id
  )
  returning id into created_item_id;

  insert into public.bank_transaction_matches (
    group_id,
    transaction_id,
    direction,
    match_type,
    target_id,
    amount,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    bank_transaction.id,
    'withdrawal',
    'accounting_expense_item',
    created_item_id,
    bank_transaction.withdrawal_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id
  );

  update public.bank_transactions
  set status = 'matched', memo = null, updated_at = now()
  where id = bank_transaction.id;

  return created_item_id;
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
    or bank_transaction.withdrawal_amount <> p_expected_amount
  then
    raise exception 'transaction amount does not match expected payment'
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

create or replace function public.match_bank_transaction_manual(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
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
  transaction_direction text;
  transaction_amount integer;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'note is required' using errcode = '22023';
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

  insert into public.bank_transaction_matches (
    group_id,
    transaction_id,
    direction,
    match_type,
    target_key,
    amount,
    note,
    created_by
  ) values (
    admin_profile.group_id,
    bank_transaction.id,
    transaction_direction,
    'manual',
    'manual:' || bank_transaction.id,
    transaction_amount,
    trim(p_note),
    admin_profile.id
  )
  returning id into match_id;

  update public.bank_transactions
  set status = 'matched', memo = trim(p_note), updated_at = now()
  where id = bank_transaction.id;

  return match_id;
end;
$$;

create or replace function public.ignore_bank_transaction(
  p_admin_profile_id uuid,
  p_transaction_id uuid,
  p_memo text
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

  update public.bank_transactions
  set
    status = 'ignored',
    memo = nullif(trim(coalesce(p_memo, '')), ''),
    updated_at = now()
  where id = p_transaction_id
    and group_id = admin_profile.group_id
    and status = 'unmatched';

  if not found then
    raise exception 'unmatched transaction not found' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.unignore_bank_transaction(
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
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.bank_transactions
  set status = 'unmatched', memo = null, updated_at = now()
  where id = p_transaction_id
    and group_id = admin_profile.group_id
    and status = 'ignored';

  if not found then
    raise exception 'ignored transaction not found' using errcode = '02000';
  end if;
end;
$$;

revoke all on function public.list_profile_payment_aliases(uuid) from public;
revoke all on function public.create_profile_payment_alias(uuid, uuid, text, text, text) from public;
revoke all on function public.update_profile_payment_alias(uuid, uuid, text, text, text) from public;
revoke all on function public.delete_profile_payment_alias(uuid, uuid) from public;
revoke all on function public.list_bank_csv_imports(uuid, integer) from public;
revoke all on function public.import_bank_transactions(uuid, jsonb, jsonb) from public;
revoke all on function public.list_bank_transactions(uuid, text, date, date) from public;
revoke all on function public.match_bank_transaction_billing_items(uuid, uuid, uuid[]) from public;
revoke all on function public.match_bank_transaction_income(uuid, uuid, text, text, text) from public;
revoke all on function public.match_bank_transaction_expense(uuid, uuid, text, text, text) from public;
revoke all on function public.match_bank_transaction_virtual_payment(uuid, uuid, text, uuid, text, integer, text) from public;
revoke all on function public.match_bank_transaction_manual(uuid, uuid, text) from public;
revoke all on function public.ignore_bank_transaction(uuid, uuid, text) from public;
revoke all on function public.unignore_bank_transaction(uuid, uuid) from public;

grant execute on function public.list_profile_payment_aliases(uuid) to anon, authenticated;
grant execute on function public.create_profile_payment_alias(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.update_profile_payment_alias(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.delete_profile_payment_alias(uuid, uuid) to anon, authenticated;
grant execute on function public.list_bank_csv_imports(uuid, integer) to anon, authenticated;
grant execute on function public.import_bank_transactions(uuid, jsonb, jsonb) to anon, authenticated;
grant execute on function public.list_bank_transactions(uuid, text, date, date) to anon, authenticated;
grant execute on function public.match_bank_transaction_billing_items(uuid, uuid, uuid[]) to anon, authenticated;
grant execute on function public.match_bank_transaction_income(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.match_bank_transaction_expense(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.match_bank_transaction_virtual_payment(uuid, uuid, text, uuid, text, integer, text) to anon, authenticated;
grant execute on function public.match_bank_transaction_manual(uuid, uuid, text) to anon, authenticated;
grant execute on function public.ignore_bank_transaction(uuid, uuid, text) to anon, authenticated;
grant execute on function public.unignore_bank_transaction(uuid, uuid) to anon, authenticated;
