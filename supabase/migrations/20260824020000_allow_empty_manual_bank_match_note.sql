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
  cleaned_note text;
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
  cleaned_note := nullif(trim(coalesce(p_note, '')), '');

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
    cleaned_note,
    admin_profile.id
  )
  returning id into match_id;

  update public.bank_transactions
  set status = 'matched', memo = cleaned_note, updated_at = now()
  where id = bank_transaction.id;

  return match_id;
end;
$$;

revoke all on function public.match_bank_transaction_manual(uuid, uuid, text) from public;
grant execute on function public.match_bank_transaction_manual(uuid, uuid, text) to anon, authenticated;
