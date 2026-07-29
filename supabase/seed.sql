insert into public.groups (id, name)
values
  ('00000000-0000-0000-0000-000000000001', 'テストチーム')
on conflict (id) do update
set name = excluded.name;

insert into public.profiles (
  id,
  group_id,
  role,
  name,
  email,
  login_code,
  login_enabled
)
values
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    'admin',
    'テスト管理者',
    'admin@example.test',
    '1234',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000001',
    'user',
    'テストユーザー',
    'user@example.test',
    '1111',
    true
  )
on conflict (id) do update
set
  group_id = excluded.group_id,
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  login_code = excluded.login_code,
  login_enabled = excluded.login_enabled;

insert into public.calendar_events (
  id,
  group_id,
  created_by,
  title,
  description,
  location,
  start_at,
  time_text,
  attendance_required
)
values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',
  'テスト練習',
  'テスト環境用の予定です。',
  '第一体育館',
  (((timezone('Asia/Tokyo', now())::date + interval '1 day')::date::text || 'T00:00:00+09:00')::timestamptz),
  '18:00-20:00',
  true
)
on conflict (id) do update
set
  title = excluded.title,
  description = excluded.description,
  location = excluded.location,
  start_at = excluded.start_at,
  time_text = excluded.time_text,
  attendance_required = excluded.attendance_required;

insert into public.billing_items (
  id,
  group_id,
  user_id,
  target_month,
  category,
  title,
  amount,
  status,
  note,
  created_by
)
values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000102',
  to_char(timezone('Asia/Tokyo', now()), 'YYYY-MM'),
  'tuition',
  '月謝',
  5000,
  'unpaid',
  'テスト環境用の未払い項目です。',
  '00000000-0000-0000-0000-000000000101'
)
on conflict (id) do update
set
  target_month = excluded.target_month,
  amount = excluded.amount,
  status = excluded.status,
  note = excluded.note;
