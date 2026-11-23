import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateLogin } from "@/lib/login";
import { getCurrentProfile, markSessionChanged } from "@/lib/auth";
import { sessionCookieName, SESSION_MAX_AGE } from "@/lib/session";
import SubmitButton from "@/components/SubmitButton";
import CodeInput from "@/components/CodeInput";
import PageHeader from "@/components/ui/PageHeader";


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
  await markSessionChanged();

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
  if (profile) redirect("/user/payment-check");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const message = errorMessage(resolvedSearchParams?.error);

  return (
    <main className="ui-page">
      <div className="mx-auto max-w-lg">
        <PageHeader title="ログイン" />
        {resolvedSearchParams?.message === "account-changed" && <p className="mt-4 rounded bg-green-100 p-3">ログイン情報を変更しました</p>}

        {message && (
          <div className="mt-6 rounded bg-red-100 p-4 font-bold text-red-700">
            {message}
          </div>
        )}

        <section aria-labelledby="new-member-heading" className="ui-card mt-6">
          <h2 id="new-member-heading" className="ui-section-title text-blue-950">はじめて利用する方</h2>
          <a href="/register" className="ui-button ui-button-primary mt-4 block text-center">新規登録</a>
        </section>

        <form
          action={login}
          className="ui-card mt-6 space-y-5"
        >
          <h2 className="ui-section-title">登録済みの方はこちら</h2>
          <div>
            <label htmlFor="login-name" className="block text-sm font-bold text-gray-900">名前</label>
            <input
              id="login-name"
              name="name"
              required
              className="ui-field mt-1 w-full placeholder:text-gray-500"
              placeholder="例：山田太郎"
            />
          </div>

          <CodeInput name="login_code" label="4桁コード" />
          <a href="/login/forgot-password" className="block text-sm underline">4桁コードを忘れた場合</a>
          <SubmitButton
            pendingText="ログイン中..."
            className="ui-button ui-button-primary w-full"
          >
            ログイン
          </SubmitButton>

        </form>
      </div>
    </main>
  );
}
