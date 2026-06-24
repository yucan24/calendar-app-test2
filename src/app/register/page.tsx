import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

type PageProps = {
  searchParams?: Promise<{
    status?: string;
    error?: string;
  }>;
};

async function register(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "")
    .replace(/\s+/g, "")
    .trim();

  const email = String(formData.get("email") ?? "").trim();
  const loginCode = String(formData.get("login_code") ?? "").trim();

  if (!name || !email || !loginCode) {
    redirect("/register?error=missing");
  }

  if (!/^\d{4}$/.test(loginCode)) {
    redirect("/register?error=code");
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (groupError || !group) {
    redirect("/register?error=group");
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("group_id", group.id)
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    redirect("/register?error=exists");
  }

  const { error } = await supabase.from("profiles").insert({
    group_id: group.id,
    role: "user",
    name,
    email,
    login_code: loginCode,
    login_enabled: false,
  });

  if (error) {
    redirect("/register?error=failed");
  }

  redirect("/register?status=done");
}

function errorMessage(error?: string) {
  if (error === "missing") return "名前、メールアドレス、4桁コードを入力してください。";
  if (error === "code") return "4桁コードは数字4桁で入力してください。";
  if (error === "group") return "グループ設定が見つかりません。管理者に確認してください。";
  if (error === "exists") return "このメールアドレスはすでに登録されています。";
  if (error === "failed") return "登録に失敗しました。";
  return "";
}

export default async function RegisterPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const message = errorMessage(resolvedSearchParams?.error);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-bold text-gray-900">会員登録</h1>
        <p className="mt-3 text-base font-medium text-gray-700">
          登録後、管理者の承認が完了するとログインできます。
        </p>

        {resolvedSearchParams?.status === "done" && (
          <div className="mt-6 rounded bg-green-100 p-4 font-bold text-green-800">
            登録申請を受け付けました。管理者の承認をお待ちください。
          </div>
        )}

        {message && (
          <div className="mt-6 rounded bg-red-100 p-4 font-bold text-red-700">
            {message}
          </div>
        )}

        <form
          action={register}
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
              メールアドレス
            </label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded border border-gray-400 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-500"
              placeholder="例：sample@example.com"
            />
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

          <button className="w-full rounded bg-black px-4 py-3 text-lg font-bold text-white">
            登録申請
          </button>

          <div className="pt-4 text-center">
            <a href="/login" className="text-base font-bold text-gray-800 underline">
              ログインへ戻る
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}