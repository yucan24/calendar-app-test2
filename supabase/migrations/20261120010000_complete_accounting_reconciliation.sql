-- 会計・銀行照合の境界値、口座別取込、分割送金と請求相殺。
-- 既存の不正対象月は削除・変換せず保持し、新規登録と更新だけを拒否する。
create or replace function public.is_valid_target_month(value text)
returns boolean language sql immutable set search_path = public
as $$ select coalesce(value ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and left(value, 4) <> '0000', false); $$;

alter table public.billing_items add constraint billing_items_valid_target_month
check (public.is_valid_target_month(target_month)) not valid;
alter table public.bank_transaction_matches add constraint bank_matches_valid_target_month
check (target_month is null or public.is_valid_target_month(target_month)) not valid;

alter table public.billing_items add column coach_payment_transaction_id uuid
references public.bank_transactions(id) on delete restrict;
alter table public.billing_items add column coach_payment_offset_month text
check (coach_payment_offset_month is null or public.is_valid_target_month(coach_payment_offset_month));
alter table public.bank_transaction_matches add column settles_payment boolean not null default false;
drop index if exists public.bank_transaction_matches_unique_target_key_idx;

-- 口座を識別する項目は区切り文字の衝突を避けてJSON配列で保持する。
create or replace function public.bank_account_key(meta jsonb)
returns text language sql immutable set search_path = public as $$
select jsonb_build_array(
 regexp_replace(normalize(coalesce(meta->>'bankName',''), NFKC), '[[:space:]]', '', 'g'),
 regexp_replace(normalize(coalesce(meta->>'branchName',''), NFKC), '[[:space:]]', '', 'g'),
 regexp_replace(normalize(coalesce(meta->>'accountType',''), NFKC), '[[:space:]]', '', 'g'),
 regexp_replace(normalize(coalesce(meta->>'accountNumber',''), NFKC), '[[:space:]]', '', 'g')
)::text;
$$;
alter table public.bank_transactions add column account_key text;
update public.bank_transactions t set account_key = public.bank_account_key(jsonb_build_object(
 'bankName', i.bank_name, 'branchName', i.branch_name,
 'accountType', i.account_type, 'accountNumber', i.account_number))
from public.bank_csv_imports i where i.id = t.import_id;
-- 元の取込情報が失われた明細は同一口座と推測せず、独立して保存する。
update public.bank_transactions set account_key = 'legacy:' || id::text where account_key is null;
alter table public.bank_transactions alter column account_key set not null;
alter table public.bank_transactions drop constraint bank_transactions_unique;
alter table public.bank_transactions add constraint bank_transactions_account_unique
unique (group_id, account_key, bank_transaction_id);
alter table public.bank_csv_imports add column conflict_count integer not null default 0 check (conflict_count >= 0);


create or replace function public.list_accounting_income_items(
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
  if not public.is_valid_target_month(p_target_month) then
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
    and item.received_on >= month_start
    and item.received_on < month_end
  order by item.received_on desc, item.created_at desc;
end;
$$;

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
  if not public.is_valid_target_month(p_target_month) then
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

create or replace function public.list_accounting_expense_items(
  p_admin_profile_id uuid,
  p_target_month text
)
returns table (
  id uuid,
  spent_on date,
  payee_name text,
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
  if not public.is_valid_target_month(p_target_month) then
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
    item.spent_on,
    item.payee_name,
    item.category,
    item.title,
    item.amount,
    item.note
  from public.accounting_expense_items as item
  where item.group_id = admin_profile.group_id
    and item.spent_on >= month_start
    and item.spent_on < month_end
  order by item.spent_on desc, item.created_at desc;
end;
$$;

create or replace function public.list_accounting_expense_items_until(
  p_admin_profile_id uuid,
  p_target_month text
)
returns table (
  id uuid,
  spent_on date,
  payee_name text,
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
  if not public.is_valid_target_month(p_target_month) then
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
    item.spent_on,
    item.payee_name,
    item.category,
    item.title,
    item.amount,
    item.note
  from public.accounting_expense_items as item
  where item.group_id = admin_profile.group_id
    and item.spent_on < month_end
  order by item.spent_on desc, item.created_at desc;
end;
$$;

create or replace function public.list_coach_reward_adjustments(
  p_admin_profile_id uuid,
  p_target_month text
)
returns table (
  id uuid,
  coach_id uuid,
  coach_name text,
  starts_on date,
  ends_on date,
  pay_rate_percent integer,
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
  if not public.is_valid_target_month(p_target_month) then
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
    adjustment.id,
    adjustment.coach_id,
    coach.name as coach_name,
    adjustment.starts_on,
    adjustment.ends_on,
    adjustment.pay_rate_percent,
    adjustment.note
  from public.coach_reward_adjustments as adjustment
  join public.profiles as coach
    on coach.id = adjustment.coach_id
  where adjustment.group_id = admin_profile.group_id
    and adjustment.starts_on < month_end
    and coalesce(adjustment.ends_on, date '9999-12-31') >= month_start
  order by adjustment.starts_on desc, coach.name asc, adjustment.created_at desc;
end;
$$;

create or replace function public.list_coach_reward_adjustments_until(
  p_admin_profile_id uuid,
  p_target_month text
)
returns table (
  id uuid,
  coach_id uuid,
  coach_name text,
  starts_on date,
  ends_on date,
  pay_rate_percent integer,
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
  if not public.is_valid_target_month(p_target_month) then
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
    adjustment.id,
    adjustment.coach_id,
    coach.name as coach_name,
    adjustment.starts_on,
    adjustment.ends_on,
    adjustment.pay_rate_percent,
    adjustment.note
  from public.coach_reward_adjustments as adjustment
  join public.profiles as coach
    on coach.id = adjustment.coach_id
  where adjustment.group_id = admin_profile.group_id
    and adjustment.starts_on < month_end
  order by adjustment.starts_on desc, coach.name asc, adjustment.created_at desc;
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

  if p_target_month is null or not public.is_valid_target_month(p_target_month) then
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

  perform pg_advisory_xact_lock(hashtextextended(admin_profile.group_id::text || built_target_key, 0));

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

drop function public.import_bank_transactions(uuid, jsonb, jsonb);

create or replace function public.import_bank_transactions(
  p_admin_profile_id uuid,
  p_import_meta jsonb,
  p_transactions jsonb
)
returns table (
  import_id uuid,
  imported_count integer,
  skipped_count integer,
  conflict_count integer,
  conflict_transaction_ids text[]
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
  conflict_total integer := 0;
  conflict_ids text[] := array[]::text[];
  existing_transaction record;
  import_account_key text;
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

  if p_import_meta is null or p_transactions is null
    or jsonb_typeof(p_import_meta) <> 'object'
    or jsonb_typeof(p_transactions) <> 'array'
  then
    raise exception 'invalid import payload' using errcode = '22023';
  end if;

  if jsonb_array_length(p_transactions) = 0
    or jsonb_array_length(p_transactions) > 5000
  then
    raise exception 'invalid transaction count' using errcode = '22023';
  end if;

  if coalesce(trim(p_import_meta->>'bankName'), '') = ''
    or coalesce(trim(p_import_meta->>'branchName'), '') = ''
    or coalesce(trim(p_import_meta->>'accountType'), '') = ''
    or coalesce(trim(p_import_meta->>'accountNumber'), '') = '' then
    raise exception 'bank account information is required' using errcode = '22023';
  end if;
  import_account_key := public.bank_account_key(p_import_meta);
  perform pg_advisory_xact_lock(hashtextextended(admin_profile.group_id::text || import_account_key, 0));

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
      account_key,
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
      import_account_key,
      trim(transaction_value ->> 'bankTransactionId'),
      transaction_date,
      withdrawal_value,
      deposit_value,
      coalesce(transaction_value ->> 'description', ''),
      coalesce(transaction_value ->> 'normalizedDescription', ''),
      balance_value,
      admin_profile.id
    )
    on conflict (group_id, account_key, bank_transaction_id) do nothing
    returning id into inserted_transaction_id;

    if inserted_transaction_id is null then
      select * into existing_transaction from public.bank_transactions
      where group_id = admin_profile.group_id and account_key = import_account_key
        and bank_transaction_id = trim(transaction_value->>'bankTransactionId');
      if row(existing_transaction.transacted_on, existing_transaction.withdrawal_amount,
        existing_transaction.deposit_amount, existing_transaction.description, existing_transaction.balance)
        is distinct from row(transaction_date, withdrawal_value, deposit_value,
          coalesce(transaction_value->>'description', ''), balance_value) then
        conflict_total := conflict_total + 1;
        if cardinality(conflict_ids) < 10 then
          conflict_ids := array_append(conflict_ids, existing_transaction.bank_transaction_id);
        end if;
      else
        skipped_total := skipped_total + 1;
      end if;
    else
      imported_total := imported_total + 1;
    end if;
  end loop;

  update public.bank_csv_imports
  set
    imported_count = imported_total,
    skipped_count = skipped_total,
    conflict_count = conflict_total
  where id = created_import_id;

  return query select created_import_id, imported_total, skipped_total, conflict_total, conflict_ids;
end;
$$;

revoke all on function public.import_bank_transactions(uuid, jsonb, jsonb) from public;
grant execute on function public.import_bank_transactions(uuid, jsonb, jsonb) to anon, authenticated;

drop function public.list_bank_csv_imports(uuid, integer);

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
  conflict_count integer,
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
    import_row.conflict_count,
    import_row.created_at
  from public.bank_csv_imports as import_row
  where import_row.group_id = admin_profile.group_id
  order by import_row.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

revoke all on function public.list_bank_csv_imports(uuid, integer) from public;
grant execute on function public.list_bank_csv_imports(uuid, integer) to anon, authenticated;

drop function public.list_bank_transactions(uuid, text, date, date);

create or replace function public.list_bank_transactions(
  p_admin_profile_id uuid,
  p_status text default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  id uuid,
  bank_transaction_id text,
  account_label text,
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
    concat_ws(' ', import_row.bank_name, import_row.branch_name,
      case when import_row.account_number is not null then '末尾' || right(import_row.account_number, 4) end) as account_label,
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
            'settlesPayment', transaction_match.settles_payment,
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
  left join public.bank_csv_imports import_row on import_row.id = bank_transaction.import_id
  where bank_transaction.group_id = admin_profile.group_id
    and (p_status is null or bank_transaction.status = p_status)
    and (p_from_date is null or bank_transaction.transacted_on >= p_from_date)
    and (p_to_date is null or bank_transaction.transacted_on <= p_to_date)
  order by bank_transaction.transacted_on desc, bank_transaction.id desc;
end;
$$;

revoke all on function public.list_bank_transactions(uuid, text, date, date) from public;
grant execute on function public.list_bank_transactions(uuid, text, date, date) to anon, authenticated;


-- 分割送金の合計は銀行明細の実額で計算する。
create or replace function public.list_bank_payment_totals(p_admin_profile_id uuid, p_target_month text)
returns table (match_type text, profile_id uuid, amount bigint, settled boolean)
language plpgsql security definer set search_path = public as $$
declare admin_profile record;
begin
 select * into admin_profile from public.get_accounting_admin_profile(p_admin_profile_id);
 if admin_profile.id is null then raise exception 'not authorized' using errcode='42501'; end if;
 if not public.is_valid_target_month(p_target_month) then raise exception 'invalid target month' using errcode='22023'; end if;
 return query select m.match_type, m.profile_id, sum(m.amount), bool_or(m.settles_payment)
 from public.bank_transaction_matches m where m.group_id=admin_profile.group_id
 and m.target_month=p_target_month and m.match_type in ('coach_net_pay','tax_payment')
 group by m.match_type,m.profile_id order by m.match_type,m.profile_id;
end;
$$;
revoke all on function public.list_bank_payment_totals(uuid,text) from public;
grant execute on function public.list_bank_payment_totals(uuid,text) to anon,authenticated;

-- 相殺済み請求の手動編集・再紐付けを防ぐ。変更は照合取消経由に限定する。
create or replace function public.protect_coach_payment_offset()
returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP = 'INSERT' then
   if (NEW.coach_payment_transaction_id is not null or NEW.coach_payment_offset_month is not null) and current_user in ('anon','authenticated') then
     raise exception '請求相殺は指導者支払いの照合から実行してください' using errcode='42501';
   end if;
   return NEW;
 end if;
 if OLD.coach_payment_transaction_id is not null or OLD.coach_payment_offset_month is not null then
   if TG_OP = 'DELETE' or current_user in ('anon','authenticated') then
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
create trigger protect_coach_payment_offset before insert or update or delete on public.billing_items
for each row execute function public.protect_coach_payment_offset();

create or replace function public.settle_coach_offsets_without_transfer(
 p_admin_profile_id uuid, p_profile_id uuid, p_target_month text,
 p_billing_item_ids uuid[], p_available_amount integer
)
returns void language plpgsql security definer set search_path=public as $$
declare admin_profile record; item_count integer; offset_total bigint;
begin
 select * into admin_profile from public.get_accounting_admin_profile(p_admin_profile_id);
 if admin_profile.id is null then raise exception 'not authorized' using errcode='42501'; end if;
 if not public.is_valid_target_month(p_target_month) then raise exception 'invalid target month' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles where id=p_profile_id and group_id=admin_profile.group_id
   and role='admin' and login_enabled) then raise exception 'coach not found' using errcode='02000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(admin_profile.group_id::text || 'coach_net_pay:' || p_target_month || ':' || p_profile_id, 0));
 if exists(select 1 from public.bank_transaction_matches where group_id=admin_profile.group_id
   and profile_id=p_profile_id and target_month=p_target_month and match_type='coach_net_pay') then
   raise exception '既に銀行送金の照合があります。先に照合を確認してください' using errcode='22023';
 end if;
 perform 1 from public.billing_items where id=any(p_billing_item_ids) order by id for update;
 select count(*),coalesce(sum(b.amount),0) into item_count,offset_total from public.billing_items b
 where b.id=any(p_billing_item_ids) and b.group_id=admin_profile.group_id and b.user_id=p_profile_id
   and b.target_month=p_target_month and b.status='unpaid' and b.amount>0 and b.title<>'返金';
 if item_count=0 or item_count<>coalesce(cardinality(p_billing_item_ids),0)
   or p_available_amount is null or offset_total<>p_available_amount then
   raise exception 'invalid billing item selection' using errcode='22023';
 end if;
 update public.billing_items set status='paid',paid_at=now(),coach_payment_offset_month=p_target_month
 where id=any(p_billing_item_ids);
end;
$$;
revoke all on function public.settle_coach_offsets_without_transfer(uuid,uuid,text,uuid[],integer) from public;
grant execute on function public.settle_coach_offsets_without_transfer(uuid,uuid,text,uuid[],integer) to anon,authenticated;

create or replace function public.cancel_coach_offsets_without_transfer(
 p_admin_profile_id uuid,p_profile_id uuid,p_target_month text
)
returns void language plpgsql security definer set search_path=public as $$
declare admin_profile record;
begin
 select * into admin_profile from public.get_accounting_admin_profile(p_admin_profile_id);
 if admin_profile.id is null then raise exception 'not authorized' using errcode='42501'; end if;
 if not public.is_valid_target_month(p_target_month) then raise exception 'invalid target month' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(admin_profile.group_id::text || 'coach_net_pay:' || p_target_month || ':' || p_profile_id, 0));
 update public.billing_items set status='unpaid',paid_at=null,coach_payment_offset_month=null
 where group_id=admin_profile.group_id and user_id=p_profile_id
   and coach_payment_offset_month=p_target_month and coach_payment_transaction_id is null;
 if not found then raise exception '取り消す相殺が見つかりません' using errcode='02000'; end if;
end;
$$;
revoke all on function public.cancel_coach_offsets_without_transfer(uuid,uuid,text) from public;
grant execute on function public.cancel_coach_offsets_without_transfer(uuid,uuid,text) to anon,authenticated;

create or replace function public.match_bank_transaction_coach_payment(
 p_admin_profile_id uuid, p_transaction_id uuid, p_profile_id uuid, p_target_month text,
 p_expected_amount integer, p_billing_item_ids uuid[], p_complete boolean, p_note text
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 admin_profile record; new_match_id uuid; payment_total bigint; item_count integer;
 payment_key text; payment_date date;
begin
 select * into admin_profile from public.get_accounting_admin_profile(p_admin_profile_id);
 if admin_profile.id is null then raise exception 'not authorized' using errcode='42501'; end if;
 payment_key := 'coach_net_pay:' || p_target_month || ':' || p_profile_id;
 perform pg_advisory_xact_lock(hashtextextended(admin_profile.group_id::text || payment_key, 0));
 perform 1 from public.bank_transactions where id=p_transaction_id and group_id=admin_profile.group_id for update;
 -- 明細→請求の順にロックし、通常の請求照合とロック順を揃える。
 perform 1 from public.billing_items where id=any(p_billing_item_ids) order by id for update;
 select count(*) into item_count from public.billing_items b
 where b.id=any(p_billing_item_ids) and b.group_id=admin_profile.group_id and b.user_id=p_profile_id
 and b.target_month=p_target_month and b.status='unpaid' and b.amount>0 and b.title<>'返金'
 and not exists(select 1 from public.bank_transaction_matches m where m.group_id=b.group_id
   and m.match_type='billing_item' and m.target_id=b.id);
 if item_count <> coalesce(cardinality(p_billing_item_ids),0) then
   raise exception 'invalid billing item selection' using errcode='22023';
 end if;
 new_match_id := public.match_bank_transaction_virtual_payment(p_admin_profile_id,p_transaction_id,
   'coach_net_pay',p_profile_id,p_target_month,p_expected_amount,p_note);
 select sum(m.amount) into payment_total from public.bank_transaction_matches m
 where m.group_id=admin_profile.group_id and m.target_key=payment_key and m.match_type='coach_net_pay';
 if coalesce(p_complete,false) or payment_total >= p_expected_amount then
   update public.bank_transaction_matches set settles_payment=true where id=new_match_id;
   select transacted_on into payment_date from public.bank_transactions where id=p_transaction_id;
   update public.billing_items set status='paid', paid_at=payment_date::timestamptz,
     coach_payment_transaction_id=p_transaction_id,coach_payment_offset_month=p_target_month
   where id=any(p_billing_item_ids);
 end if;
 return new_match_id;
end;
$$;
revoke all on function public.match_bank_transaction_coach_payment(uuid,uuid,uuid,text,integer,uuid[],boolean,text) from public;
grant execute on function public.match_bank_transaction_coach_payment(uuid,uuid,uuid,text,integer,uuid[],boolean,text) to anon,authenticated;


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
  payment_match record;
  remaining_paid bigint;
  next_transaction_id uuid;
begin
  select * into admin_profile
  from public.get_accounting_admin_profile(p_admin_profile_id);

  if admin_profile.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  for payment_match in select target_key from public.bank_transaction_matches
    where transaction_id=p_transaction_id and group_id=admin_profile.group_id and match_type='coach_net_pay'
  loop
    perform pg_advisory_xact_lock(hashtextextended(admin_profile.group_id::text || payment_match.target_key, 0));
  end loop;

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

  for payment_match in
    select m.target_key, m.expected_amount from public.bank_transaction_matches m
    where m.transaction_id=bank_transaction.id and m.match_type='coach_net_pay'
  loop
    select coalesce(sum(m.amount),0) into remaining_paid from public.bank_transaction_matches m
    where m.group_id=admin_profile.group_id and m.target_key=payment_match.target_key
      and m.match_type='coach_net_pay' and m.transaction_id<>bank_transaction.id;
    if remaining_paid < payment_match.expected_amount then
      update public.billing_items b set status='unpaid',paid_at=null,coach_payment_transaction_id=null,coach_payment_offset_month=null
      where b.coach_payment_transaction_id in (
        select m.transaction_id from public.bank_transaction_matches m
        where m.group_id=admin_profile.group_id and m.target_key=payment_match.target_key
          and m.match_type='coach_net_pay');
      update public.bank_transaction_matches set settles_payment=false
      where group_id=admin_profile.group_id and target_key=payment_match.target_key and match_type='coach_net_pay';
    else
      select m.transaction_id into next_transaction_id from public.bank_transaction_matches m
      where m.group_id=admin_profile.group_id and m.target_key=payment_match.target_key
        and m.match_type='coach_net_pay' and m.transaction_id<>bank_transaction.id order by m.id limit 1;
      update public.billing_items set coach_payment_transaction_id=next_transaction_id
      where coach_payment_transaction_id=bank_transaction.id;
      update public.bank_transaction_matches set settles_payment=true
      where transaction_id=next_transaction_id and match_type='coach_net_pay';
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

  perform 1 from public.billing_items where id=any(p_billing_item_ids) order by id for update;

  select count(*)
  into item_count
  from public.billing_items
  where id = any(p_billing_item_ids)
    and group_id = admin_profile.group_id
    and status = 'unpaid'
    and coach_payment_transaction_id is null
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
