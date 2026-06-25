import RegisterForm from "./RegisterForm";

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-gray-900">会員登録</h1>

        <p className="mt-3 text-sm font-medium text-gray-700">
          登録後、管理者が承認するとログインできるようになります。
        </p>

        <RegisterForm />

        <div className="mt-6">
          <a href="/login" className="font-bold text-gray-900 underline">
            ログイン画面に戻る
          </a>
        </div>
      </div>
    </main>
  );
}
