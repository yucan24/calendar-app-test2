alter table public.profiles
add column if not exists coach_hourly_rate integer;

update public.profiles
set coach_hourly_rate = 1000
where coach_hourly_rate is null;

alter table public.profiles
alter column coach_hourly_rate set default 1000;

alter table public.profiles
alter column coach_hourly_rate set not null;

alter table public.profiles
drop constraint if exists profiles_coach_hourly_rate_check;

alter table public.profiles
add constraint profiles_coach_hourly_rate_check
check (coach_hourly_rate >= 0);
