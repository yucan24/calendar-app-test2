import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SubmitButton from "@/components/SubmitButton";


type PageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

async function login(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "")
    .replace(/\s+/g, "")
    .trim();

  const loginCode = String(formData.get("login_code") ?? "").trim();

  if (!name || !loginCode) {
    redirect("/login?error=missing");
  }

  if (!/^\d{4}$/.test(loginCode)) {
    redirect("/login?error=code");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, login_enabled")
    .eq("name", name)
    .eq("login_code", loginCode)
    .maybeSingle();

  if (error || !profile) {
    redirect("/login?error=failed");
  }

  if (!profile.login_enabled) {
    redirect("/login?error=pending");
  }

  const cookieStore = await cookies();

  cookieStore.set("profile_id", profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  if (profile.role === "admin") {
    redirect("/admin");
  }

  redirect("/user/payment-check");
}

function errorMessage(error?: string) {
  if (error === "missing") return "名前と4桁コードを入力してください。";
  if (error === "code") return "4桁コードは数字4桁で入力してください。";
  if (error === "failed") return "名前または4桁コードが違います。";
  if (error === "pending") return "管理者の承認が完了していません。";
  return "";
}

export default async function LoginPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const message = errorMessage(resolvedSearchParams?.error);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-bold text-gray-900">ログイン</h1>
        <p className="mt-3 text-base font-medium text-gray-700">
          名前と4桁コードを入力してください。
        </p>

        {message && (
          <div className="mt-6 rounded bg-red-100 p-4 font-bold text-red-700">
            {message}
          </div>
        )}

        <form
          action={login}
          className="mt-6 space-y-5 rounded-lg bg-white p-6 shadow"
        >
          <div>
            <label className="block text-sm font-bold text-gray-900">名前</label>
            <input
              name="name"
              required
              className="mt-1 w-full rounded border border-gray-400 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-500"
              placeholder="例：山田太郎"
            />
            <p className="mt-1 text-xs font-medium text-gray-700">
              空白は自動で削除されます。
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-900">
              4桁コード
            </label>
            <input
              name="login_code"
              required
              inputMode="numeric"
              maxLength={4}
              className="mt-1 w-full rounded border border-gray-400 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-500"
              placeholder="例：1234"
            />
          </div>
          <SubmitButton
            pendingText="ログイン中..."
            className="w-full rounded bg-black px-4 py-3 text-lg font-bold text-white">
          >
            ログイン
          </SubmitButton>

          <div className="pt-4 text-center">
            <a
              href="/register"
              className="text-base font-bold text-gray-800 underline"
            >
              会員登録はこちら
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}
