create table if not exists public.coach_reward_adjustments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date,
  pay_rate_percent integer not null default 100 check (
    pay_rate_percent >= 0 and pay_rate_percent <= 100
  ),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_reward_adjustments_date_range_check check (
    ends_on is null or ends_on >= starts_on
  )
);

create index if not exists coach_reward_adjustments_group_period_idx
on public.coach_reward_adjustments (group_id, starts_on, ends_on);

create index if not exists coach_reward_adjustments_coach_period_idx
on public.coach_reward_adjustments (coach_id, starts_on, ends_on);

drop trigger if exists set_coach_reward_adjustments_updated_at
on public.coach_reward_adjustments;

create trigger set_coach_reward_adjustments_updated_at
before update on public.coach_reward_adjustments
for each row execute function public.set_updated_at();

alter table public.coach_reward_adjustments enable row level security;

revoke all on table public.coach_reward_adjustments from anon, authenticated;

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

create or replace function public.create_coach_reward_adjustment(
  p_admin_profile_id uuid,
  p_coach_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_pay_rate_percent integer,
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
    where id = p_coach_id
      and group_id = admin_profile.group_id
      and role = 'admin'
      and login_enabled = true
  ) then
    raise exception 'coach not found' using errcode = '02000';
  end if;

  if p_starts_on is null then
    raise exception 'starts_on is required' using errcode = '22023';
  end if;

  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  if p_pay_rate_percent is null
    or p_pay_rate_percent < 0
    or p_pay_rate_percent > 100
  then
    raise exception 'invalid pay rate percent' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.coach_reward_adjustments
    where group_id = admin_profile.group_id
      and coach_id = p_coach_id
      and starts_on <= coalesce(p_ends_on, date '9999-12-31')
      and coalesce(ends_on, date '9999-12-31') >= p_starts_on
  ) then
    raise exception 'reward adjustment overlaps' using errcode = '23505';
  end if;

  insert into public.coach_reward_adjustments (
    group_id,
    coach_id,
    starts_on,
    ends_on,
    pay_rate_percent,
    note,
    created_by,
    updated_at
  )
  values (
    admin_profile.group_id,
    p_coach_id,
    p_starts_on,
    p_ends_on,
    p_pay_rate_percent,
    nullif(trim(coalesce(p_note, '')), ''),
    admin_profile.id,
    now()
  )
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.update_coach_reward_adjustment(
  p_admin_profile_id uuid,
  p_adjustment_id uuid,
  p_coach_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_pay_rate_percent integer,
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

  if not exists (
    select 1
    from public.profiles
    where id = p_coach_id
      and group_id = admin_profile.group_id
      and role = 'admin'
      and login_enabled = true
  ) then
    raise exception 'coach not found' using errcode = '02000';
  end if;

  if p_starts_on is null then
    raise exception 'starts_on is required' using errcode = '22023';
  end if;

  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  if p_pay_rate_percent is null
    or p_pay_rate_percent < 0
    or p_pay_rate_percent > 100
  then
    raise exception 'invalid pay rate percent' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.coach_reward_adjustments
    where group_id = admin_profile.group_id
      and coach_id = p_coach_id
      and id <> p_adjustment_id
      and starts_on <= coalesce(p_ends_on, date '9999-12-31')
      and coalesce(ends_on, date '9999-12-31') >= p_starts_on
  ) then
    raise exception 'reward adjustment overlaps' using errcode = '23505';
  end if;

  update public.coach_reward_adjustments
  set
    coach_id = p_coach_id,
    starts_on = p_starts_on,
    ends_on = p_ends_on,
    pay_rate_percent = p_pay_rate_percent,
    note = nullif(trim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = p_adjustment_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'reward adjustment not found' using errcode = '02000';
  end if;
end;
$$;

create or replace function public.delete_coach_reward_adjustment(
  p_admin_profile_id uuid,
  p_adjustment_id uuid
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

  delete from public.coach_reward_adjustments
  where id = p_adjustment_id
    and group_id = admin_profile.group_id;

  if not found then
    raise exception 'reward adjustment not found' using errcode = '02000';
  end if;
end;
$$;

grant execute on function public.list_coach_reward_adjustments(uuid, text)
to anon, authenticated;

grant execute on function public.list_coach_reward_adjustments_until(uuid, text)
to anon, authenticated;

grant execute on function public.create_coach_reward_adjustment(uuid, uuid, date, date, integer, text)
to anon, authenticated;

grant execute on function public.update_coach_reward_adjustment(uuid, uuid, uuid, date, date, integer, text)
to anon, authenticated;

grant execute on function public.delete_coach_reward_adjustment(uuid, uuid)
to anon, authenticated;
