# Environment Setup

## Supabase projects

The team owns two separate Tokyo (`ap-northeast-1`) projects. Production is live at https://nsct-u15bbc.vercel.app (Vercel project `ncst1/nsct-u15bbc`, Hobby plan, region `hnd1`).

| Purpose | Project ref | Status as of 2026-11-20 |
| --- | --- | --- |
| Production destination | `wswntpyibylcrjjdmguy` | Backup restored; production app connected; public DB API blocked |
| Local development / test | `xvgqwdiyoorzejfozoca` | Synthetic seed only; local app and CLI target |
| Legacy development | `lrusdklwqsjtotraskvx` | Inactive; do not use |
| Legacy production | `tqkblkxjgbnxoqkralmn` | Inaccessible; not modified or required for this restore |

Other apps' active projects were not stopped or modified.

## Local configuration

`.env.local` and `supabase/.temp/project-ref` point to the test project:

```env
SUPABASE_URL=https://xvgqwdiyoorzejfozoca.supabase.co
SUPABASE_SECRET_KEY=<test secret key or legacy service_role JWT>
APP_GROUP_ID=00000000-0000-0000-0000-000000000001
```

The Supabase module is `server-only`. The configured server key may be a new secret key or legacy service_role JWT. Never put it in a `NEXT_PUBLIC_` variable. Legacy public keys are no longer used for database access. Do not commit `.env.local`. `APP_GROUP_ID` fixes the destination of registration requests; authorization uses the session profile’s actual group.

`src/lib/environment.ts` refuses production URLs in development, test URLs in Vercel Production, and production URLs in Vercel Preview. `.env.example` is the test template and `.env.production.example` is the production template; neither contains keys.

Run `npm run dev`, or `npm run dev -- --hostname 127.0.0.1 --port 3010` if port 3000 is occupied.

## Migrations and test data

Both projects have all 18 migrations through `20261120030000_secure_server_sessions.sql`, recorded with their original SQL in `supabase_migrations.schema_migrations`. Do not rerun initialization or seed during startup.

The test project was initialized in one transaction, guarded by an empty public schema, with migration history and `supabase/seed.sql`. It contains one team, two profiles, one practice event, and one unpaid tuition item for 5,000 yen. No production data was copied to test.

| Role | Name | Login code |
| --- | --- | --- |
| Admin | `テスト管理者` | `1234` |
| User | `テストユーザー` | `1111` |

Global CLI 2.108.0 can access metadata but direct database login times out. Isolated official CLI 3.2.0 uses the Management API successfully:

```bash
npx --yes supabase@3.2.0 db query --remote=xvgqwdiyoorzejfozoca --read-only --output json "select version, name from supabase_migrations.schema_migrations order by version"
```

Always specify the project ref. Add future changes as new migration files. `db push --dry-run --remote=xvgqwdiyoorzejfozoca --skip-vault` still requires direct database connectivity. An API-based write must apply reviewed SQL and its migration-history entry together, after checking the target and existing versions. Never reset or drop a database to solve a connection error.

## Production restore

Source: `/Users/kyo05/Downloads/db_cluster-29-09-2026@08-35-50.backup.gz`, left unchanged. Despite the September filename, the latest updates in the main application records are from June 2026. Data absent from this backup has not been recovered.

This is a SQL cluster dump. Do not execute it wholesale against Supabase. Only the `postgres` database's application `public` COPY data was extracted. Cluster roles, passwords, managed schemas, old function definitions, and old migration history were not executed. This backup contains no Auth users or Storage objects to migrate.

| Restored table | Rows |
| --- | ---: |
| groups | 2 |
| profiles | 13 |
| calendar_events | 20 |
| event_responses | 20 |
| billing_items | 11 |
| coach_work_logs | 4 |
| ticket_balances | 4 |
| Eight other application tables | 0 |
| Total | 74 |

Legacy profile flags (`is_approved`, `is_active`, `is_coach`), work-log status, and ticket balances are retained by migration `20261120020000`, even where current screens do not use them.

The complete operation was rehearsed with PGlite. A private snapshot confirmed that the destination contained only our known synthetic seed. One transaction locked the existing application tables, asserted their full contents had not changed, applied the last migration, removed only that seed, inserted the backup data, and checked every source column's count and content digest before committing. All 15 table digests matched. Production access restrictions were applied in the same transaction.

Preparation can be repeated locally without contacting a hosted database:

```bash
node scripts/prepare-backup-restore.mjs --backup '/path/to/db_cluster.backup.gz' --out /private/tmp/calendar-restore-new-directory
```

The output directory must be new. It uses mode 0700; output files use mode 0600. Generated SQL contains member data and login codes: keep it outside Git and logs. Preparation performs no cloud writes. Private artifacts for this restore are in `/private/tmp/calendar-production-restore-20261120`; temporary files are not a durable backup.

## Authentication and database access

Migration `20261120030000` adds `app_sessions` and `app_auth_rate_limits`, and restricts direct public access in both environments. The server issues a random 32-byte session token after verifying the existing name, four-digit code, and approval flag under a database row lock. Only SHA-256 token hashes are stored. Production uses a Secure, HttpOnly, SameSite=Lax `__Host-nsct_session` cookie with a 30-day lifetime. Development uses `nsct_session`.

Every protected request checks the stored session expiry and the current profile. Logout deletes the session. Changes to name, login code, group, role, or login-enabled status revoke that profile’s sessions. Old unsigned `profile_id` cookies are ignored. Login limits persist across server instances: 5 attempts per account per 15 minutes, 20 per account per day, and 100 per IP per 15 minutes. Registration allows 20 attempts per IP per hour. Failed rate-limit checks deny access.

The server-only Supabase client holds the service credential. Every administrative Action verifies the logged-in administrator and scopes the operation to that administrator’s group. Attendance forms use the authenticated user ID; administrator edits also verify both the event and member belong to the same team. The legacy calendar-day route redirects to the protected main calendar.

All 17 public tables have RLS enabled. `PUBLIC`, `anon`, and `authenticated` cannot access tables or execute public RPCs; `service_role` retains server access. `supabase/production/restrict-public-access.sql` can reapply these restrictions after future migrations in either environment. Never restore broad public permissions to make an old client work.

## Vercel production deployment

- Project: `ncst1/nsct-u15bbc` (`prj_7XxVYQDbE96h3FvHhojYOL4SgX3x`), Hobby plan.
- Canonical URL: https://nsct-u15bbc.vercel.app ; alternate: https://nsct-u15bbc-ncst1.vercel.app .
- Deployment: `dpl_4UHc9SXb6zjTaMm8uwm7CjubBQQM` (2026-11-20), Next.js 16.4.6, Tokyo `hnd1`.
- Production variables: production `SUPABASE_URL`, secret `SUPABASE_SECRET_KEY`, `APP_GROUP_ID=c2c54afe-9602-42b5-a31c-3bab6be27088`.
- Preview variables: test URL, test server key, and seed group ID. Preview cannot use production data.

The GitHub repository could not be connected under this Vercel account. This release uses the authorized local source through official CLI 66.5.0, without Git integration. Pushes do not automatically update production. The working tree has not been committed or pushed.

The release source was staged outside the Git checkout, containing application source, public assets, package files, and build configuration. `.vercelignore` excludes environment files, CSVs, backups, database scripts, and tests. A private SHA-256 source manifest is in `/private/tmp/calendar-production-release-20261120`. The CLI created a production deployment with `--skip-domain`; its build and login form were checked before `vercel promote` assigned the public URLs.

For later releases, test first, prepare reviewed source without environment files, and deploy to this linked project. Environment variables must be configured in Vercel; server keys belong in Secret variables. Do not pull production credentials into local development. Do not rerun seed or reset either database.

The temporary deployment-protection bypass credential created by CLI verification was revoked after use. The application’s own session login remains required for all protected pages.

## Validation

37 Node/PGlite tests passed. TypeScript, ESLint, the Next.js 16.4.6 production build, and `npm audit` (0 vulnerabilities) passed. The latest migration was also rehearsed against the original backup and applied with a transaction-level guard ensuring all 15 business tables stayed unchanged.

Test: both logins, 13 HTTP page checks, role redirects, old/modified Cookie rejection, and logout revocation passed. Production: restored administrator and user logins, Secure/HttpOnly cookies, 15 HTTP pages including all accounting tabs and event details, 9 access/redirect checks, logout/replay rejection, and 20 browser assets checked for absence of server credentials all passed. Verification created only authentication records and removed its sessions; it did not edit business data.

Browser visual inspection remains pending because the browser control host was unavailable. The backup’s June data limitation still applies. Other apps and legacy databases were not modified.
