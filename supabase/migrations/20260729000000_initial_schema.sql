create extension if not exists pgcrypto with schema extensions;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  name text not null,
  email text not null default '',
  login_code text check (login_code is null or login_code ~ '^[0-9]{4}$'),
  login_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_key unique (name),
  constraint profiles_group_name_key unique (group_id, name)
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz,
  time_text text,
  is_holiday boolean not null default false,
  title_color text default '#000000',
  location_color text default '#000000',
  time_color text default '#000000',
  attendance_required boolean not null default true,
  display_type text not null default 'normal' check (display_type in ('normal', 'period')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('attend', 'absent', 'pending')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_responses_event_user_key unique (event_id, user_id)
);

create table if not exists public.billing_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_month text not null check (target_month ~ '^[0-9]{4}-[0-9]{2}$'),
  category text not null check (category in ('tuition', 'trip', 'event', 'uniform', 'other')),
  title text not null,
  amount integer not null default 0 check (amount >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'exempt')),
  due_date date,
  note text,
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_work_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  entered_by uuid references public.profiles(id) on delete set null,
  work_date date not null,
  coaching_minutes integer not null default 0 check (coaching_minutes >= 0),
  admin_minutes integer not null default 0 check (admin_minutes >= 0),
  travel_expense integer not null default 0 check (travel_expense >= 0),
  other_expense integer not null default 0 check (other_expense >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_group_role_idx on public.profiles (group_id, role);
create index if not exists profiles_login_lookup_idx on public.profiles (name, login_code);
create index if not exists calendar_events_group_start_idx on public.calendar_events (group_id, start_at);
create index if not exists event_responses_event_idx on public.event_responses (event_id);
create index if not exists event_responses_user_idx on public.event_responses (user_id);
create index if not exists billing_items_group_user_idx on public.billing_items (group_id, user_id);
create index if not exists billing_items_user_status_idx on public.billing_items (user_id, status);
create index if not exists billing_items_target_month_idx on public.billing_items (target_month);
create index if not exists coach_work_logs_group_date_idx on public.coach_work_logs (group_id, work_date);
create index if not exists coach_work_logs_coach_date_idx on public.coach_work_logs (coach_id, work_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_groups_updated_at on public.groups;
create trigger set_groups_updated_at
before update on public.groups
for each row execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_calendar_events_updated_at on public.calendar_events;
create trigger set_calendar_events_updated_at
before update on public.calendar_events
for each row execute function public.set_updated_at();

drop trigger if exists set_event_responses_updated_at on public.event_responses;
create trigger set_event_responses_updated_at
before update on public.event_responses
for each row execute function public.set_updated_at();

drop trigger if exists set_billing_items_updated_at on public.billing_items;
create trigger set_billing_items_updated_at
before update on public.billing_items
for each row execute function public.set_updated_at();

drop trigger if exists set_coach_work_logs_updated_at on public.coach_work_logs;
create trigger set_coach_work_logs_updated_at
before update on public.coach_work_logs
for each row execute function public.set_updated_at();

-- The current app uses its own profile_id cookie auth with the Supabase anon key.
-- RLS is intentionally left disabled here so the current code can run unchanged.
-- Revisit this before broadening production access or changing the auth model.
alter table public.groups disable row level security;
alter table public.profiles disable row level security;
alter table public.calendar_events disable row level security;
alter table public.event_responses disable row level security;
alter table public.billing_items disable row level security;
alter table public.coach_work_logs disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.groups to anon, authenticated;
grant select, insert, update, delete on table public.profiles to anon, authenticated;
grant select, insert, update, delete on table public.calendar_events to anon, authenticated;
grant select, insert, update, delete on table public.event_responses to anon, authenticated;
grant select, insert, update, delete on table public.billing_items to anon, authenticated;
grant select, insert, update, delete on table public.coach_work_logs to anon, authenticated;
grant execute on function public.set_updated_at() to anon, authenticated;
