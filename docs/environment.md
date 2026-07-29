# Environment Setup

## Supabase Projects

This repository uses one codebase and separates environments by Supabase project.

| Purpose | Owner | Project ref | Notes |
| --- | --- | --- | --- |
| Production | Yukiya-san | `tqkblkxjgbnxoqkralmn` | Existing DB. Treat as production/reference and do not modify during development. |
| Test / Development | Kyo | `lrusdklwqsjtotraskvx` | Use this from local development and Vercel Preview. |

## Local `.env.local`

Local development should point at the test Supabase project.

```env
NEXT_PUBLIC_SUPABASE_URL=https://lrusdklwqsjtotraskvx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_TzmHQKx_8kuoar_6evLyXw_upckel-s
```

Do not put `service_role`, secret keys, JWT secrets, or database passwords in this repository.

## Applying The Test Schema

The current Supabase CLI link may point at the production/reference project. Check carefully before running any write command.

```bash
supabase link --project-ref lrusdklwqsjtotraskvx
supabase db push
```

Seed data is not pushed by `db push`. After the schema exists, load `supabase/seed.sql` into the test project from Supabase SQL Editor, or with a local database tool using the test DB connection string.

## Test Login

Seeded users:

| Role | Name | Login code |
| --- | --- | --- |
| Admin | `テスト管理者` | `1234` |
| User | `テストユーザー` | `1111` |
