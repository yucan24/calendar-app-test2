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

Both projects have 20 migrations through `20261121010000_prevent_duplicate_tuition.sql`, each recorded with its original SQL in `supabase_migrations.schema_migrations`. There are still 19 public tables; migration 20 adds an index and a function. Do not rerun initialization or seed during startup.

The test project was initially created with synthetic seed data. On 2026-11-20 the user requested a reset and replacement with the August–October sheets of the supplied workbook. The initial imported fixture had one team, 15 profiles (12 coaches plus test/admin/aggregate accounts), 21 events, 202 work/memo/reimbursement records, three paid aggregate tuition items of 140,000 yen each, four pay-adjustment periods, and nine expense items. Subsequent account tests added records; validation compares against the actual starting data rather than resetting to this initial count. July work and accounting records are excluded. The 7/28 start dates belong only to the requested pay-adjustment rules.

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

## Current backups (2026-11-22)

See [backup.md](backup.md) for the current encrypted backup, daily macOS schedule, retention, verification and empty-project restore runbook. The first production backup (3 business rows plus 4 notification records) and test backup (257 business rows plus 4 notification records) both passed a local full-schema restore and source-content fingerprint comparison. These are read-only exports; hosted tables and mail delivery were not changed.

Production backups are in ignored `.backups/production/`, test backups in `.backups/test/`, and the private encryption key in ignored `.backup-secrets/backup.key`. The user LaunchAgent `jp.nsct.calendar.backup` checks hourly while the Mac is running/logged in, creates one production snapshot per Japan-calendar day, and retains the latest 30 successful artifacts. Its initial scheduled run exited 0 and authenticated/skipped today's existing backup. `npm run backup:status` checks freshness, file checksum and availability of the matching key. The user explicitly chose Mac-only storage for this task on 2026-11-22. Off-Mac storage is not configured, so these copies do not cover loss of this Mac. The old temporary paths below are historical evidence, not the current backup location.

An additional forced acquisition through the actual LaunchAgent initially failed because CLI 3.2.0 returns a plain JSON array outside agent sessions, whereas Codex sessions receive a `rows` wrapper. The parser now accepts both. The old success receipt was restored after the failed attempt and no existing backup was deleted. After the correction, the actual background process fetched production, encrypted it, restored and compared all 7 rows, and exited successfully at 20:40 JST. This verifies real unattended acquisition, beyond the initial skip-only check. Both output formats are covered by the CLI regression tests. Earlier failure lines remain in the private historical logs; the latest attempt and success are PASS.

## Historical production restore

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

Successful login always opens `/user/payment-check`, including for administrators/coaches. Authenticated visits to `/` or `/login` use the same entry. This page reads only the current member's bills within their group; its return link uses the role's own menu, and its main button leads administrators to `/admin` and ordinary members to `/user/calendar`. Administrators can reopen their personal payment check from the admin menu. Opening an admin menu/calendar directly does not repeatedly force the payment page; no new acknowledgement state or session invalidation is introduced.

Tabs on the same browser origin share the authentication cookie. Login and logout now also rotate a separate public UUID cookie (`__Host-nsct_session_version` in production, `nsct_session_version` in development). This nonce contains no user identity or session token and grants no access. The root layout passes only this nonce to `SessionSync`; it does not expose the authentication cookie or query the DB for synchronization. Storage events, focus, visibility and history restoration refresh stale tabs, and a capture-phase submit check blocks stale forms before sending them. Storage failure falls back to cookie checks on focus/submit. Membership actions are also bound to the administrator who rendered the page, rejecting a stale page after switching to another administrator; member UI state is keyed by that administrator. Authorization still uses the server-verified session for every protected request/action.

The server-only Supabase client holds the service credential. Every administrative Action verifies the logged-in administrator and scopes the operation to that administrator’s group. Attendance forms use the authenticated user ID; administrator edits also verify both the event and member belong to the same team. The legacy calendar-day route redirects to the protected main calendar.

All 19 public tables have RLS enabled. `PUBLIC`, `anon`, and `authenticated` cannot access tables or execute public RPCs; `service_role` retains server access. `supabase/production/restrict-public-access.sql` can reapply these restrictions after future migrations in either environment. Never restore broad public permissions to make an old client work.

Monthly tuition has a partial unique index on `(group_id, user_id, target_month)` for `category='tuition'`. The server-only `create_monthly_tuition` RPC verifies the active administrator and inserts eligible members in one statement with `ON CONFLICT DO NOTHING`. Existing paid/exempt items, amounts and notes are retained. Repeated calls return zero additional rows; individual duplicate creation or edits are rejected. Other billing categories still permit multiple items per month.

## Vercel production deployment

- Project: `ncst1/nsct-u15bbc` (`prj_7XxVYQDbE96h3FvHhojYOL4SgX3x`), Hobby plan.
- Canonical URL: https://nsct-u15bbc.vercel.app ; alternate: https://nsct-u15bbc-ncst1.vercel.app .
- Deployment: `dpl_8BmWP7E6prMi3EMryWWARRo3tVKY` (2026-11-23), immutable URL https://nsct-u15bbc-ckihr2jof-ncst1.vercel.app . Synchronizes login state across tabs and blocks stale membership actions after switching administrators. Retains the requested admin menu order, personal payment check on login, `NSCT-U15BBC webapp` name, mobile layouts, in-app billing reminders, single-column menus, navigation fixes and tuition uniqueness. Both DBs remain at migration 20; no DB, environment or SMTP configuration changes.
- Previous deployment: `dpl_CeUMacNvkSPZqVAN2nJjiVu5SGqh` (admin menu order), retained. Coach/admin payment entry: `dpl_DiLjTaKgTiUUMi4TFmHMYvpfN1UT`; app name: `dpl_6cYJMvwbh5HBMmqobCiiZCqwaiHy`; mobile layouts and billing reminders: `dpl_2w7LDJ9QPyDLnQ6C6UrmxfXDUdvy`; tuition duplication fix: `dpl_4RW9ESpKBUDR4TLfKDRu4gEjUQ9o`; earlier single-column menus: `dpl_GVtYfHhZ63rdHTgnmakBBLFhjiwW`; shared UI: `dpl_9ovAc2ooh1fUVS994fFX5aV8oQGG`; contextual return links: `dpl_8fsNCbrovm75mPBrip4YGPszFkD8`; session/month navigation: `dpl_8wrT429dvmPTBYCRQk3Wz1YAm7rm`; code-input colors: `dpl_8AT79eTqrwsfwvbf2c1eJMCTdeG2`; membership UI: `dpl_GoXZLU7VAxJxy23DPytsGPtanWNk`; account lifecycle: `dpl_Az8MKhhEc7S4h6pyuMXvszy6g8rV`; fractional-hours fix: `dpl_5k6e2pfcpvSLHq5GfPvktYH6JzXM`; initial authentication release: `dpl_4UHc9SXb6zjTaMm8uwm7CjubBQQM`.
- Production variables: production `SUPABASE_URL`, secret `SUPABASE_SECRET_KEY`, `APP_GROUP_ID=c2c54afe-9602-42b5-a31c-3bab6be27088`.
- Preview variables: test URL, test server key, and seed group ID. Preview cannot use production data.

The GitHub repository could not be connected under this Vercel account. This release uses the authorized local source through official CLI 66.5.0, without Git integration. Pushes do not automatically update production.

The verified release source is maintained on `main` in https://github.com/yucan24/calendar-app-test2 . The completed `accounting-tax-report-test` work and the remote logout-prefetch fix have been integrated, retaining the current production implementation (POST logout and a non-mutating GET route). Existing work branches are retained as history. Start future changes from current `main`, verify them against the test environment, then merge and push to `main`. Branch names do not select a database: environment variables and the existing environment guards determine the test/production connection. Production deployment remains a separate reviewed CLI operation.

The release source is staged outside the Git checkout and contains application source, public assets, package files, and build configuration. Environment files, CSVs, backups, database scripts, documentation, tests and test data are excluded. The current session-sync release is in `/private/tmp/calendar-session-sync-release-20261123`: 111 uploaded application files, with seven existing source files changed and one client component added from the menu-order release. Source hashes, secret-value scan and official CLI dry run passed. After READY, `vercel promote` assigned the public URLs; the public alias is checked with official CLI inspection and read-only HTTP checks, including denial of authentication using only the public version cookie. No production test data or email was created. Earlier manifests include `/private/tmp/calendar-admin-menu-order-20261123`, `/private/tmp/calendar-coach-payment-release-20261123`, `/private/tmp/calendar-app-name-release-20261123`, `/private/tmp/calendar-mobile-mail-release-20261123` and `/private/tmp/calendar-tuition-dedup-20261122`. Temporary directories may be cleared between sessions and are not durable backups.

For later releases, test first, prepare reviewed source without environment files, and deploy to this linked project. Environment variables must be configured in Vercel; server keys belong in Secret variables. Do not pull production credentials into local development. Do not rerun seed or reset either database.

The temporary deployment-protection bypass credential created by CLI verification was revoked after use. The application’s own session login remains required for all protected pages.

## Validation

Final coach-only release check (2026-11-23): the current production deployment remains `dpl_8BmWP7E6prMi3EMryWWARRo3tVKY`; all 112 staged source/config hashes match the workspace (111 uploaded files), so no redeployment was needed. Fifteen production routes and eight public script assets passed, with no known local server/mail secret values in served HTML/JS. Production has 19 RLS-protected tables, no anon/authenticated direct table/RPC access, no plaintext codes or deleted accounts retaining credentials, and a valid tuition unique index with no duplicates. Required production variable names are present; secret values were not fetched. Current local SMTP credentials passed TLS/authentication verification with zero messages sent. `npm audit --omit=dev` reported zero known vulnerabilities. The existing 162 passing tests/build remain applicable because app source is unchanged.

The current production-format Next.js build was exercised against an isolated test-Supabase team: real login, six authenticated HTTP pages, report totals, native CSV file selection/import/reimport, PNG download/visual inspection and accounting back/forward navigation. CSV produced one new row then one skipped duplicate and did not change paid billing/work. PNG 2560×2092 matched income 7,000, expense 2,500, balance 4,500 and coach transfer 1,398 yen. An intentionally invalid CSV header date was rejected before import. The isolated two-member fixture and sessions were removed; all 16 pre-existing tables/261 rows matched before/after. Temporary browser/server state was closed; the original production tab was preserved. A fresh encrypted production backup passed local restore verification at 2026-11-23 20:53 JST. No production business writes, real emails, environment changes or app source changes were made by this final check. Physical-device coverage and actual inbox delivery remain for the coach pilot. See section 41 of `テスト.md`.

Cross-tab membership/session fix (2026-11-23): the user confirmed testing another member in a separate tab and returning to login without a deletion completion message. A real local Next.js/test-Supabase HTTP reproduction matched this: render the admin page, log out the shared session elsewhere, then submit the stale form; authentication redirects before any deletion. Native Chrome also confirmed that both permanent and history-preserving deletion correctly revoke only the targets' sessions and preserve the actor and financial history. After the UI fix, actual two-tab logout/login correctly clears stale management screens and synchronizes them to the current member. All 162 tests passed (seven new synchronization cases and two membership lifecycle regressions), along with ESLint, Webpack/TypeScript and Vercel build. The four-member/one-bill fixture and all sessions were removed; all 16 existing tables and 261 rows matched the starting hashes. No production data writes, emails or DB/config changes. Authenticated production clicks and physical-device coverage are not claimed. See section 40 of `テスト.md`.

Payment entry for coaches/admins (2026-11-23): all 153 Node/Postgres tests passed, including seven new cases for successful/failed login form submission, authenticated entry routes, personal bill/refund/history isolation, empty state, role-specific onward/back links, admin menu and unauthenticated access. Lint and Webpack build with TypeScript passed. The previous name change's feedback-subject expectation was also updated in the existing regression test; application behavior was unchanged by that test correction. Verification used local PGlite with real migrations and session RPCs; production checks are read-only deployment/HTTP checks. No cloud fixture, bill update, real email or migration was created. This release was not checked through authenticated browser clicks; earlier mobile emulation and pending real-device coverage remain as recorded in section 36. See section 38 of `テスト.md`.

Mobile and billing reminders (2026-11-22–23): all 146 Node/Postgres tests passed (11 new reminder cases and one account-email retry regression). Lint, Webpack build, TypeScript and Vercel build passed. Native Chrome device emulation at 320px and 375px covered both roles, calendars, attendance save, accounting tabs/cards, CSV history and preview/select/test-send of two reminders. Delivery was explicitly disabled for the test server: two test receipts, zero actual emails. The isolated five-member/seven-bill fixture and all its sessions were removed; all 16 preserved tables matched the starting hashes (261 existing rows). Production was verified by official deployment inspection, ten read-only public HTTP checks and served CSS. The final authenticated production UI check could not run because native Chrome access timed out; no browser action was performed in that check. Physical iOS Safari/Android, complete browser back/forward coverage, actual CSV file selection/upload and visual PNG output remain pending. See section 36 of `テスト.md`.

Tuition duplication fix (2026-11-22): all 124 Node/Postgres tests passed, including eight new tuition/migration cases and the previously failing BILL-02 regression. Live test-Supabase checks passed all 12 items: 24 concurrent RPC requests from two administrators for eight eligible members, retries preserving paid/exempt items, manual/bulk races, scope/permission validation and concurrent real form POSTs. Both exact guarded migration wrappers were rehearsed locally before the original test application; the production wrapper was rehearsed again on resumption. All 15 business-table values are preserved by transactional hash assertions, and before/after fingerprints match (257 test rows, 3 production rows). The new function body matches source, the unique index is valid and public execution remains denied. Lint, Webpack build and TypeScript passed. Production verification is schema/source/read-only HTTP; no real production charges or emails were created. See section 34 of `テスト.md`. Section 35 subsequently resolves the F33-01 backup/restore tooling issue, brings that suite to 134 passing tests, and records current encrypted backups and the local schedule. Mac-only storage remains the user's selected scope. Section 36 records the subsequent mobile browser checks.

UI-unification release (2026-11-21): 23 focused tests, 70 test-Supabase HTTP checks and 66 production HTTP checks passed. The served CSS and shared header/back-link markup were checked; this is not visual browser verification. Form action/submit/input attributes in all 46 modified existing TSX files match the baseline; business `.ts` modules are unchanged. Full suite: 115 passes and the known BILL-02 failure out of 116. Lint, Webpack build, TypeScript and final Vercel build passed. Final blank-line cleanup emits identical JavaScript. Browser-host access was rechecked and remains unavailable. See section 31 of `テスト.md` for data-preservation and fixture-cleanup evidence. Use the shared components in `src/components/ui` and styles in `globals.css` for future screens.

Return-navigation release (2026-11-21): 22 focused Node/Postgres tests, 53 test-Supabase HTTP checks and 49 production HTTP checks passed. These include signed-out/user/admin return links and revisiting `/login` with a valid session, along with the previous navigation checks. Full suite: 114 passes and the one known BILL-02 failure out of 115. Lint, TypeScript, local Webpack and Vercel builds passed. Browser host access was rechecked and remains unavailable; modal-close behavior was inspected in code, not exercised in a browser. See section 30 of `テスト.md` for data-preservation and fixture-cleanup evidence.

Navigation release (2026-11-21): production reproduction confirmed that a prefetch-equivalent GET to the old logout route revoked a valid session. After the fix, all 16 focused Node/Postgres tests, 29 test-Supabase HTTP checks, and 25 authenticated production HTTP checks passed. Lint, TypeScript, local Webpack build and Vercel build passed. The full suite has 108 passes and one known BILL-02 failure (concurrent tuition creation). The prior maximum-year calendar failure is fixed. All 15 business tables matched before/after: 257 test rows and 3 production rows. The isolated production team, two synthetic members, their sessions and account-specific rate-limit counters were removed. No actual email, existing-member changes or shared-IP counter resets. Browser clicks, back/forward and client-router cache behavior remain unverified because the browser host is unavailable. See section 29 of `テスト.md`.

Initial authentication release: 37 Node/PGlite tests passed. TypeScript, ESLint, the Next.js 16.4.6 production build, and `npm audit` (0 vulnerabilities) passed. The latest migration was also rehearsed against the original backup and applied with a transaction-level guard ensuring all 15 business tables stayed unchanged.

Fractional-hours fix: all six work-related tests and the live test-Supabase checks passed; the complete suite has 63 passes and three known failures in unrelated features. TypeScript, ESLint, local Webpack build, and the Vercel production build passed. After publication, both roles could log in with secure sessions; nine page checks, work-page access guards, and logout/replay checks passed. No business-data writes were performed in production, and all 15 business-table fingerprints (74 rows) matched before and after. Verification sessions were revoked and the temporary copy of verification login details was removed. See section 20 of `テスト.md` for the deployment record.

Test: both logins, 13 HTTP page checks, role redirects, old/modified Cookie rejection, and logout revocation passed. Production: restored administrator and user logins, Secure/HttpOnly cookies, 15 HTTP pages including all accounting tabs and event details, 9 access/redirect checks, logout/replay rejection, and 20 browser assets checked for absence of server credentials all passed. Verification created only authentication records and removed its sessions; it did not edit business data.

The initial release had no browser visual inspection because the browser control host was unavailable. Section 36 now records major mobile flows checked through native Chrome; it does not cover every historical pending browser test. The backup’s June data limitation still applies. Other apps and legacy databases were not modified.


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
