create extension if not exists pgcrypto with schema extensions;

create table if not exists public.developer_feedback (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  profile_name text not null default '',
  profile_role text not null default 'user' check (profile_role in ('admin', 'user')),
  category text not null check (category in ('bug', 'usability', 'request', 'other')),
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  page_path text,
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists developer_feedback_group_created_idx
on public.developer_feedback (group_id, created_at desc);

create index if not exists developer_feedback_status_created_idx
on public.developer_feedback (status, created_at desc);

drop trigger if exists set_developer_feedback_updated_at on public.developer_feedback;
create trigger set_developer_feedback_updated_at
before update on public.developer_feedback
for each row execute function public.set_updated_at();

alter table public.developer_feedback disable row level security;

grant usage on schema public to anon, authenticated;
grant insert on table public.developer_feedback to anon, authenticated;
