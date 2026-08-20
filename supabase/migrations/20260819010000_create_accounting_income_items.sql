create table if not exists public.accounting_income_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  received_on date not null,
  payer_name text not null,
  category text not null default 'sponsorship' check (category in ('sponsorship', 'other')),
  title text not null,
  amount integer not null default 0 check (amount >= 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_income_items_group_received_on_idx
on public.accounting_income_items (group_id, received_on);

create index if not exists accounting_income_items_group_category_idx
on public.accounting_income_items (group_id, category);

drop trigger if exists set_accounting_income_items_updated_at
on public.accounting_income_items;

create trigger set_accounting_income_items_updated_at
before update on public.accounting_income_items
for each row execute function public.set_updated_at();

alter table public.accounting_income_items enable row level security;

revoke all on table public.accounting_income_items from anon, authenticated;

create or replace function public.accounting_income_title(input_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when input_category = 'sponsorship' then '協賛金'
    else 'その他収入'
  end;
$$;

create or replace function public.get_accounting_admin_profile(
  p_admin_profile_id uuid
)
returns table (
  id uuid,
  group_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select profiles.id, profiles.group_id
  from public.profiles
  where profiles.id = p_admin_profile_id
    and profiles.role = 'admin'
    and profiles.login_enabled = true;
end;
$$;

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
    and item.received_on >= month_start
    and item.received_on < month_end
  order by item.received_on desc, item.created_at desc;
end;
$$;

create or replace function public.create_accounting_income_item(
  p_admin_profile_id uuid,
  p_received_on date,
  p_payer_name text,
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

  if p_category not in ('sponsorship', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'invalid amount' using errcode = '22023';
  end if;

  if nullif(trim(p_payer_name), '') is null then
    raise exception 'payer name is required' using errcode = '22023';
  end if;

  insert into public.accounting_income_items (
    group_id,
    received_on,
    payer_name,
    category,
    title,
    amount,
    note,
    created_by,
    updated_at
  )
  values (
    admin_profile.group_id,
    p_received_on,
    trim(p_payer_name),
    p_category,
    public.accounting_income_title(p_category),
    p_amount,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id,
    now()
  )
  returning id into created_id;

  return created_id;
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

  delete from public.accounting_income_items
  where id = p_item_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'income item not found' using errcode = '02000';
  end if;
end;
$$;

revoke all on function public.accounting_income_title(text) from public;
revoke all on function public.get_accounting_admin_profile(uuid) from public;

grant execute on function public.list_accounting_income_items(uuid, text)
to anon, authenticated;

grant execute on function public.create_accounting_income_item(uuid, date, text, text, integer, text)
to anon, authenticated;

grant execute on function public.update_accounting_income_item(uuid, uuid, date, text, text, integer, text)
to anon, authenticated;

grant execute on function public.delete_accounting_income_item(uuid, uuid)
to anon, authenticated;
