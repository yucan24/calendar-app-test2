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
  select combined.*
  from (
    select
      'income'::text as item_type,
      item.id as item_id,
      item.received_on as item_date,
      item.payer_name as party_name,
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
      'expense'::text as item_type,
      item.id as item_id,
      item.spent_on as item_date,
      item.payee_name as party_name,
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
  ) as combined
  order by combined.item_date desc, combined.item_id;
end;
$$;
