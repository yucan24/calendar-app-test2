# Environment Setup

## Supabase projects

The team owns two separate Tokyo (`ap-northeast-1`) projects. Production is live at https://nsct-u15bbc.vercel.app (Vercel project `ncst1/nsct-u15bbc`, Hobby plan, region `hnd1`).

| Purpose | Project ref | Status as of 2026-11-20 |
| --- | --- | --- |
| Production destination | `wswntpyibylcrjjdmguy` | User-requested clean reset: one team and one bootstrap administrator; public DB API blocked |
| Local development / test | `xvgqwdiyoorzejfozoca` | August–October workbook fixture; local app and CLI target |
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

Both projects have 19 migrations through `20261120040000_account_lifecycle.sql`, each recorded with its original SQL in `supabase_migrations.schema_migrations`. Do not rerun initialization or seed during startup.

The test project was initially created with synthetic seed data. On 2026-11-20 the user requested a reset and replacement with the August–October sheets of the supplied workbook. The current fixture has one team, 15 profiles (12 coaches plus test/admin/aggregate accounts), 21 events, 202 work/memo/reimbursement records, three paid aggregate tuition items of 140,000 yen each, four pay-adjustment periods, and nine expense items. July work and accounting records are excluded. The 7/28 start dates belong only to the requested pay-adjustment rules.

The name and weekday columns match 2026. The four specified coaches have 50% pay during the inclusive start/end dates; the coach with a 500-yen hourly rate uses 250 yen during the reduction. Circled work symbols are preserved as notes with zero paid hours, as confirmed by the user. Tuition has no member-level breakdown, so each month is represented by one clearly labeled aggregate bill. Fees and the undated September reimbursement are booked at month end with explicit notes. No bank statements or actual bank payments have been invented. The production database was not changed.

Originals and detailed fixture audits are under ignored `testdata/`; they are excluded from Git and Vercel uploads. A private snapshot of all 17 test tables was taken before the reset. The reset preserved schema and permissions and verified every imported value in the same transaction.

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

Every protected request checks the stored session expiry and the current profile. Logout is a POST Server Action that deletes only the current session and expires its cookie with the issuing Secure/HttpOnly/SameSite/Path attributes. GET `/logout` redirects to `/` without changing cookies or sessions, including when prefetched. Changes to name, login code, group, role, or login-enabled status revoke that profile’s sessions. Old unsigned `profile_id` cookies are ignored. Login limits persist across server instances: 5 attempts per account per 15 minutes, 20 per account per day, and 100 per IP per 15 minutes. Registration allows 20 attempts per IP per hour. Failed rate-limit checks deny access.

The server-only Supabase client holds the service credential. Every administrative Action verifies the logged-in administrator and scopes the operation to that administrator’s group. Attendance forms use the authenticated user ID; administrator edits also verify both the event and member belong to the same team. The legacy calendar-day route redirects to the protected main calendar.

All 19 public tables have RLS enabled. `PUBLIC`, `anon`, and `authenticated` cannot access tables or execute public RPCs; `service_role` retains server access. `supabase/production/restrict-public-access.sql` can reapply these restrictions after future migrations in either environment. Never restore broad public permissions to make an old client work.

## Vercel production deployment

- Project: `ncst1/nsct-u15bbc` (`prj_7XxVYQDbE96h3FvHhojYOL4SgX3x`), Hobby plan.
- Canonical URL: https://nsct-u15bbc.vercel.app ; alternate: https://nsct-u15bbc-ncst1.vercel.app .
- Deployment: `dpl_GVtYfHhZ63rdHTgnmakBBLFhjiwW` (2026-11-21), Next.js 16.4.6, Tokyo `hnd1`. Administrator/user menu cards stay in one column at every viewport width. Only the menu-grid CSS changed; the shared UI and navigation fixes are retained. No DB migration or environment changes.
- Previous deployment: `dpl_9ovAc2ooh1fUVS994fFX5aV8oQGG` (shared UI), retained. Contextual return links: `dpl_8fsNCbrovm75mPBrip4YGPszFkD8`; session/month navigation: `dpl_8wrT429dvmPTBYCRQk3Wz1YAm7rm`; code-input colors: `dpl_8AT79eTqrwsfwvbf2c1eJMCTdeG2`; membership UI: `dpl_GoXZLU7VAxJxy23DPytsGPtanWNk`; account lifecycle: `dpl_Az8MKhhEc7S4h6pyuMXvszy6g8rV`; fractional-hours fix: `dpl_5k6e2pfcpvSLHq5GfPvktYH6JzXM`; initial authentication release: `dpl_4UHc9SXb6zjTaMm8uwm7CjubBQQM`.
- Production variables: production `SUPABASE_URL`, secret `SUPABASE_SECRET_KEY`, `APP_GROUP_ID=c2c54afe-9602-42b5-a31c-3bab6be27088`.
- Preview variables: test URL, test server key, and seed group ID. Preview cannot use production data.

The GitHub repository could not be connected under this Vercel account. This release uses the authorized local source through official CLI 66.5.0, without Git integration. Pushes do not automatically update production. The working tree has not been committed or pushed.

The release source is staged outside the Git checkout and contains application source, public assets, package files, and build configuration. Environment files, CSVs, backups, database scripts, documentation, tests and test data are excluded. Private source manifests are in `/private/tmp/calendar-production-release-20261120` (initial release), `/private/tmp/calendar-work-fix-release-20261120` (fractional-hours fix), and `/private/tmp/calendar-account-upgrade-20261120/release` (98-file account release). Navigation releases are in `/private/tmp/calendar-navigation-fix-20261121` and `/private/tmp/calendar-return-navigation-20261121`; shared UI is in `/private/tmp/calendar-ui-unification-20261121`. The latest single-column menu release is in `/private/tmp/calendar-menu-column-20261121`: 107 uploaded application files, with only `src/app/globals.css` changed. It was built with `--skip-domain`; after READY, `vercel promote` assigned the public URLs. Official CLI inspection confirmed the public alias points to `dpl_GVtYfHhZ63rdHTgnmakBBLFhjiwW`.

For later releases, test first, prepare reviewed source without environment files, and deploy to this linked project. Environment variables must be configured in Vercel; server keys belong in Secret variables. Do not pull production credentials into local development. Do not rerun seed or reset either database.

The temporary deployment-protection bypass credential created by CLI verification was revoked after use. The application’s own session login remains required for all protected pages.

## Validation

UI-unification release (2026-11-21): 23 focused tests, 70 test-Supabase HTTP checks and 66 production HTTP checks passed. The served CSS and shared header/back-link markup were checked; this is not visual browser verification. Form action/submit/input attributes in all 46 modified existing TSX files match the baseline; business `.ts` modules are unchanged. Full suite: 115 passes and the known BILL-02 failure out of 116. Lint, Webpack build, TypeScript and final Vercel build passed. Final blank-line cleanup emits identical JavaScript. Browser-host access was rechecked and remains unavailable. See section 31 of `テスト.md` for data-preservation and fixture-cleanup evidence. Use the shared components in `src/components/ui` and styles in `globals.css` for future screens.

Return-navigation release (2026-11-21): 22 focused Node/Postgres tests, 53 test-Supabase HTTP checks and 49 production HTTP checks passed. These include signed-out/user/admin return links and revisiting `/login` with a valid session, along with the previous navigation checks. Full suite: 114 passes and the one known BILL-02 failure out of 115. Lint, TypeScript, local Webpack and Vercel builds passed. Browser host access was rechecked and remains unavailable; modal-close behavior was inspected in code, not exercised in a browser. See section 30 of `テスト.md` for data-preservation and fixture-cleanup evidence.

Navigation release (2026-11-21): production reproduction confirmed that a prefetch-equivalent GET to the old logout route revoked a valid session. After the fix, all 16 focused Node/Postgres tests, 29 test-Supabase HTTP checks, and 25 authenticated production HTTP checks passed. Lint, TypeScript, local Webpack build and Vercel build passed. The full suite has 108 passes and one known BILL-02 failure (concurrent tuition creation). The prior maximum-year calendar failure is fixed. All 15 business tables matched before/after: 257 test rows and 3 production rows. The isolated production team, two synthetic members, their sessions and account-specific rate-limit counters were removed. No actual email, existing-member changes or shared-IP counter resets. Browser clicks, back/forward and client-router cache behavior remain unverified because the browser host is unavailable. See section 29 of `テスト.md`.

Initial authentication release: 37 Node/PGlite tests passed. TypeScript, ESLint, the Next.js 16.4.6 production build, and `npm audit` (0 vulnerabilities) passed. The latest migration was also rehearsed against the original backup and applied with a transaction-level guard ensuring all 15 business tables stayed unchanged.

Fractional-hours fix: all six work-related tests and the live test-Supabase checks passed; the complete suite has 63 passes and three known failures in unrelated features. TypeScript, ESLint, local Webpack build, and the Vercel production build passed. After publication, both roles could log in with secure sessions; nine page checks, work-page access guards, and logout/replay checks passed. No business-data writes were performed in production, and all 15 business-table fingerprints (74 rows) matched before and after. Verification sessions were revoked and the temporary copy of verification login details was removed. See section 20 of `テスト.md` for the deployment record.

Test: both logins, 13 HTTP page checks, role redirects, old/modified Cookie rejection, and logout revocation passed. Production: restored administrator and user logins, Secure/HttpOnly cookies, 15 HTTP pages including all accounting tabs and event details, 9 access/redirect checks, logout/replay rejection, and 20 browser assets checked for absence of server credentials all passed. Verification created only authentication records and removed its sessions; it did not edit business data.

Browser visual inspection remains pending because the browser control host was unavailable. The backup’s June data limitation still applies. Other apps and legacy databases were not modified.


## Account lifecycle upgrade (production and test applied)

The name + four-digit sign-in remains. Migration `20261120040000_account_lifecycle.sql` hashes existing codes with pgcrypto bcrypt (cost 10), keeps their leading zeros, sets the plaintext `login_code` field to NULL, and makes future legacy writes to that field hash immediately. The field is retained only as a transitional write input. Application forms never read it or display current credentials. Existing enabled profiles stay active; old disabled profiles are explicitly marked for review rather than guessed to be pending applications or suspended members.

New applications contain a name and email. An administrator receives a notification; approval creates an initial-setup state and sends a link. The member sets and confirms their own code, then becomes active. Existing approved members keep their codes and can use `/account` for name/code changes and email verification/change. Name/code changes require the current code. The login name changes with the name, and sessions are revoked after identity or credential changes.

`/login/forgot-password` accepts name + registered email, replies without disclosing account existence, and only sends self-service reset links to verified addresses on active accounts. Shared family addresses remain supported. Email verification/change and password setup/reset links last 30 minutes and are single-use. GET only shows a confirmation form. Consumption is transactional and checks the current credential, email, and account state; expired, reused, changed, suspended, or deleted account links fail. Tokens are stored only as SHA-256 hashes. Link generation never uses a request Host header.

An administrator can send/retry account notices and, after checking identity, generate a manual one-use recovery link when email cannot be used. Manual recovery does not falsely mark an address as verified. A profile with business references is archived with credentials and email removed; a profile without business references can be physically deleted. The target name must be entered before deletion. Self-removal and removal of the last administrator are rejected under a team-level transaction lock. Past accounting uses persistent `accounting_coach` eligibility rather than current login privileges or role. Archived members' billing and work history stay accessible for bookkeeping.

Mail is synchronous SMTP delivery from application actions; notification metadata records sent/failed/disabled outcomes, and administrators can retry. No plaintext codes or reset links are stored in notification records or application log statements. This change does not introduce scheduled billing reminders or change the feedback mailto.

### Email configuration

Sender and administrator inbox: `nsctu15bbc.webapp@gmail.com`. Set the following server variables:

- `APP_URL`: canonical app origin; local test is `http://127.0.0.1:3010`, production is `https://nsct-u15bbc.vercel.app`.
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=nsctu15bbc.webapp@gmail.com`.
- `SMTP_PASSWORD`: Gmail app password; keep it in `.env.local` or a Vercel Secret. It is not the ordinary Google password.
- `EMAIL_FROM=NSCT U15BBC <nsctu15bbc.webapp@gmail.com>` and `ACCOUNT_ADMIN_EMAIL=nsctu15bbc.webapp@gmail.com`.
- Production: `EMAIL_DELIVERY_MODE=production`, with production Supabase and `VERCEL_ENV=production`.
- Local/test: `EMAIL_DELIVERY_MODE=disabled` by default, even if SMTP credentials are available. For a deliberate test delivery, set `EMAIL_DELIVERY_MODE=test` and `EMAIL_TEST_TO` to a controlled inbox. All test recipients are redirected there; an absent test inbox rejects sending.

Gmail requires 2-step verification to create an app password: [Google account help](https://support.google.com/accounts/answer/185833?hl=ja). SMTP transport follows [Nodemailer SMTP documentation](https://nodemailer.com/smtp); credential hashing follows [PostgreSQL pgcrypto documentation](https://www.postgresql.org/docs/current/pgcrypto.html).

The user entered the SMTP credential locally; connection/authentication verification passed without sending email. Production SMTP variables have been configured; the app password is stored as a Vercel Secret. Production automatic account email is enabled. No real emails were sent by the implementation tests.

### Migration evidence and production procedure

The test upgrade was rehearsed against a private 255-row snapshot with real pgcrypto, using the exact guarded migration transaction. All 15 business tables are compared before/after; profile comparison permits only credential removal and new lifecycle fields. Existing IDs, names, emails, roles, timestamps and the August–October accounting totals were preserved. The guarded SQL also verifies old codes against the new hashes and records migration history atomically. Test public access remains denied: no RLS-disabled public tables, no anon-readable tables, no anon-executable public functions.

Private preparation artifacts and snapshots: `/private/tmp/calendar-account-upgrade-20261120`. This is not a durable backup. For later production changes, verify the explicit production project and migration history, use a guarded transaction with database-internal before/after snapshots, configure production-only variables securely, and build/promote reviewed source. Check login, settings, accounting and session revocation afterwards. Existing business data must remain unchanged except credential storage and the new fields. Do not send member notifications during deployment verification.

The user explicitly approved production reflection. Migration 19 and the account release are now live at `dpl_Az8MKhhEc7S4h6pyuMXvszy6g8rV`. Production had 75 business rows immediately before this upgrade (five work logs; the original restore had four). The guarded transaction preserved all business values apart from replacing plaintext codes and adding lifecycle fields. Production verification used an isolated temporary team and two synthetic members, without reading existing members’ credentials or sending emails; these fixtures and their sessions were removed afterwards.


The attempt to export all current production rows locally was rejected by automatic approval review because it would transfer personal and authentication data without explicit approval for that export. It was not retried through another route. The production upgrade instead compared complete before/after values within the database transaction, and only row counts/content hashes were retained locally. A syntax error in the additional production-target guard stopped the first SQL attempt before any change; after correcting it, the exact production SQL (including the target guard) passed local rehearsal and applied successfully. The supplied original backup was left unchanged.

The latest release source manifest is `/private/tmp/calendar-account-upgrade-20261120/release/manifest.json`; its 98 files exclude environment files, credentials, tests, documentation and test data. Private metadata/check results are in the same parent directory. The production SMTP password was supplied to the Vercel CLI through stdin and stored as a Secret, never a command-line value or log entry. All future account-triggered emails use the configured production sender; deployment checks themselves sent zero emails. Full browser visual inspection and inbox-delivery confirmation remain unperformed.

Final production cleanup verification: all 15 business-table hashes (all columns, including hashed credentials and new lifecycle fields) match the immediately post-migration baseline; 75 rows remain. The temporary team, two synthetic members, tokens, sessions and their dedicated rate-limit counters were removed.


## User-requested production data reset (2026-11-20)

After account deployment, the user explicitly requested removal of all production registrations and business data, leaving only `nsctu15bbc.webapp@gmail.com` as administrator. That address was configured as the sender but was not a member. The user approved creating login name `NSCT管理者` and sending its setup email.

A new administrator was created in the fixed production registration team (`c2c54afe-9602-42b5-a31c-3bab6be27088`) in the invited state. Its one-use setup link was issued while the previous administrator still existed. The SMTP server accepted one setup email to the approved address. After delivery acceptance, a rehearsed, locked transaction cleared all other members and application records, while preserving the new identity and its setup token. It also preserves a code if the owner completes setup before reset finishes. Passwords were never selected or assigned by the operator in production; the owner chooses their four digits through the link.

Immediately after reset: one group and one profile; all other 13 business tables empty. One initial setup notification was retained, and an unused setup token remained only until activation/expiry. Schema and 19 migrations, RLS, public-access restrictions, SMTP variables, the Vercel deployment and the fixed group ID were unchanged. Existing sessions and rate-limit records were cleared for the fresh start. The test project and August–October fixture were untouched. The 2026-11-21 navigation verification preserved the then-current one group and two profiles; no fixture data remains.

The administrator was still awaiting initial setup at final verification. The public login/register pages and the setup form returned HTTP 200; the setup link was not consumed by verification. The local raw-token copy was deleted. Private guarded SQL and result metrics are in `/private/tmp/calendar-production-user-reset-20261120`; no full production export was taken. The old restore/migration integrity counts elsewhere in this document describe the state before this explicitly requested reset.
