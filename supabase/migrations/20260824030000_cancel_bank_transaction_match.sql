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
    select id, match_type, target_id
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
    elsif transaction_match.match_type = 'accounting_income_item' then
      delete from public.accounting_income_items
      where id = transaction_match.target_id
        and group_id = admin_profile.group_id;
    elsif transaction_match.match_type = 'accounting_expense_item' then
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

revoke all on function public.cancel_bank_transaction_match(uuid, uuid) from public;
grant execute on function public.cancel_bank_transaction_match(uuid, uuid) to anon, authenticated;
