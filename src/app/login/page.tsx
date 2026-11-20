import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateLogin } from "@/lib/login";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";
import { sessionCookieName, SESSION_MAX_AGE } from "@/lib/session";
import SubmitButton from "@/components/SubmitButton";
import CodeInput from "@/components/CodeInput";


type PageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

async function login(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "")
    .replace(/\s+/g, "")
    .trim();

  const loginCode = String(formData.get("login_code") ?? "").trim();

  if (!name || name.length > 100 || !loginCode) {
    redirect("/login?error=missing");
  }

  if (!/^\d{4}$/.test(loginCode)) {
    redirect("/login?error=code");
  }

  const result = await authenticateLogin(name, loginCode);
  if (!result.ok) redirect(`/login?error=${result.reason}`);

  const cookieStore = await cookies();

  cookieStore.delete("profile_id");
  cookieStore.set(sessionCookieName(), result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  if (result.role === "admin") {
    redirect("/admin");
  }

  redirect("/user/payment-check");
}

function errorMessage(error?: string) {
  if (error === "missing") return "名前と4桁コードを入力してください。";
  if (error === "code") return "4桁コードは数字4桁で入力してください。";
  if (error === "failed") return "名前または4桁コードが違います。";
  if (error === "pending") return "このアカウントは現在ログインできません。承認・初期設定・利用状態を管理者に確認してください。";
  if (error === "limited") return "ログインの試行回数が上限に達しました。時間をおいてお試しください。";
  if (error === "unavailable") return "ただいまログインできません。時間をおいてお試しください。";
  return "";
}

export default async function LoginPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (profile) redirect(getMenuPath(profile.role));
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const message = errorMessage(resolvedSearchParams?.error);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-bold text-gray-900">ログイン</h1>
        {resolvedSearchParams?.message === "account-changed" && <p className="mt-4 rounded bg-green-100 p-3">ログイン情報を変更しました</p>}

        {message && (
          <div className="mt-6 rounded bg-red-100 p-4 font-bold text-red-700">
            {message}
          </div>
        )}

        <section aria-labelledby="new-member-heading" className="mt-6 rounded-xl border-2 border-blue-200 bg-blue-50 p-5">
          <h2 id="new-member-heading" className="text-lg font-bold text-blue-950">はじめて利用する方</h2>
          <a href="/register" className="mt-4 block rounded-lg bg-blue-700 px-4 py-3 text-center font-bold text-white hover:bg-blue-800">新規登録</a>
        </section>

        <form
          action={login}
          className="mt-6 space-y-5 rounded-lg bg-white p-6 shadow"
        >
          <h2 className="text-lg font-bold">登録済みの方はこちら</h2>
          <div>
            <label htmlFor="login-name" className="block text-sm font-bold text-gray-900">名前</label>
            <input
              id="login-name"
              name="name"
              required
              className="mt-1 w-full rounded border border-gray-400 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-500"
              placeholder="例：山田太郎"
            />
          </div>

          <CodeInput name="login_code" label="4桁コード" />
          <a href="/login/forgot-password" className="block text-sm underline">4桁コードを忘れた場合</a>
          <SubmitButton
            pendingText="ログイン中..."
            className="w-full rounded bg-black px-4 py-3 text-lg font-bold text-white"
          >
            ログイン
          </SubmitButton>

        </form>
      </div>
    </main>
  );
}
