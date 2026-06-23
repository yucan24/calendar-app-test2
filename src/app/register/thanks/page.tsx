export default function RegisterThanksPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">登録申請を受け付けました</h1>

        <p className="mt-4 text-sm text-gray-700">
          管理者の承認が完了すると、ログインできるようになります。
        </p>

        <a
          href="/login"
          className="mt-6 inline-block rounded bg-black px-4 py-2 text-white"
        >
          ログイン画面へ
        </a>
      </div>
    </main>
  );
}