# Calendar App Test2

バスケットボールチーム向けの予定共有・出欠管理・請求管理・会計管理アプリです。

管理者は予定作成、会員管理、月謝や遠征費などの請求、指導者勤務、月次会計レポートを管理できます。ユーザーはログイン後にカレンダー確認、出欠回答、未払い項目の確認を行います。

## 技術構成

- Framework: Next.js
- Language: TypeScript
- UI: React / Tailwind CSS
- Backend / DB: Supabase
- Hosting: Vercel

主な依存関係:

```json
{
  "@supabase/supabase-js": "^2.108.2",
  "next": "16.2.9",
  "react": "19.2.4",
  "react-dom": "19.2.4",
  "typescript": "^5",
  "tailwindcss": "^4"
}
```

## 主な機能

- ログイン
  - Supabase Authではなく、`profiles` テーブルの `name` + `login_code` でログインする。
  - `role = admin` の場合は管理者画面へ遷移する。

- カレンダー
  - 管理者による予定作成・編集。
  - ユーザーによる出欠回答。
  - 期間予定、休み、表示色などに対応。

- 会員管理
  - 登録申請の承認。
  - 会員情報の編集。
  - ログイン可否、管理者権限の管理。

- 請求管理
  - 月謝、遠征費、大会費、ユニフォーム代、その他請求の登録。
  - 未払い、支払い済み、免除の状態管理。
  - 返金項目の管理。

- 指導者勤怠・立替管理
  - 指導時間、事務時間、交通費、その他立替の記録。

- 会計管理
  - 月謝、協賛金、その他収入の集計。
  - 指導者報酬、源泉税、その他出費の集計。
  - 指導者別の報酬・税額・手取り表示。
  - 月次レポートの画像出力。

- 開発者への意見
  - DB保存ではなく、固定メールアドレス宛の `mailto:` で送信する。

## 主な画面

```text
/login                    ログイン
/register                 新規登録
/admin                    管理者トップ
/admin/calendar           管理者カレンダー
/admin/coach-work         指導者勤怠・立替管理
/admin/accounting         会計管理
/admin/users              ユーザー・請求管理
/admin/members            会員管理
/user                     ユーザートップ
/user/calendar            ユーザーカレンダー
/user/payment-check       支払い確認
/user/history             履歴
/feedback                 開発者への意見
```

## 環境変数

`.env.local` をプロジェクトルート、つまり `package.json` と同じ階層に置きます。

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`NEXT_PUBLIC_` が付く値はブラウザ側にも公開されます。Supabaseの publishable / anon key のみを入れ、service role key や secret key は入れないでください。

## ローカル開発

```bash
npm install
npm run dev
```

ローカルURL:

```text
http://localhost:3000
```

ログイン画面:

```text
http://localhost:3000/login
```

## テスト環境と本番環境

このプロジェクトでは、本番DBを直接触らずに修正・検証するため、Supabaseのテスト環境と本番環境を分けて運用します。

現在のテストSupabase project:

```text
lrusdklwqsjtotraskvx
```

本番Supabase project:

```text
tqkblkxjgbnxoqkralmn
```

DB migration や検証用データ投入を行う前に、必ず接続先を確認してください。

```bash
cat supabase/.temp/project-ref
```

テスト作業では `lrusdklwqsjtotraskvx` であることを確認します。`tqkblkxjgbnxoqkralmn` の場合は本番DBなので、安易に `supabase db push` やデータ投入を行わないでください。

## Supabase CLI

テストDBにmigrationを適用する例:

```bash
supabase link --project-ref lrusdklwqsjtotraskvx
export SUPABASE_DB_PASSWORD='テストDBのDatabase Password'
supabase db push
```

本番DBへ適用する場合は、事前に内容を十分確認し、ユーザーから明示的な許可を得てから実行します。

## 注意事項

- `.env.local` はGitにコミットしない。
- 銀行明細CSVなど個人情報を含むファイルはGitにコミットしない。
- 本番Supabaseのテーブル、RLS/Policy、既存データは調査なしに変更しない。
- ログイン方式は独自実装であり、`profile_id` cookie に依存しているため、将来的に認可設計の見直し余地がある。
- 請求・会計・銀行明細照合まわりは本番影響が大きいので、まずテスト環境で検証する。

## 検証コマンド

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
```

`npm run build` 後に `next-env.d.ts` が差分になることがあります。不要な差分であれば内容を確認して戻してください。
