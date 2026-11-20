-- Preserve application data found in the original production backup.
-- These fields are retained even though the current screens primarily use login_enabled/role.
alter table public.profiles
  add column if not exists is_approved boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_coach boolean not null default false;

alter table public.coach_work_logs
  add column if not exists status text not null default 'submitted';
alter table public.coach_work_logs
  add constraint coach_work_logs_status_check check (status in ('submitted', 'approved'));

create table if not exists public.ticket_balances (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  remaining_count integer not null default 0,
  expires_at date,
  updated_at timestamptz default now()
);

create index if not exists ticket_balances_group_user_idx
  on public.ticket_balances(group_id, user_id);

alter table public.ticket_balances enable row level security;
revoke all on table public.ticket_balances from public, anon, authenticated;
grant all on table public.ticket_balances to service_role;
