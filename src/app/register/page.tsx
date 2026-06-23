import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

async function registerMember(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").replace(/\s+/g, "");
  const email = String(formData.get("email") ?? "").trim();
  const loginCode = String(formData.get("login_code") ?? "").trim();

  if (!name || !email || !loginCode) {
    throw new Error("名前、メールアドレス、4桁パスワードを入力してください");
  }

  if (!/^\d{4}$/.test(loginCode)) {
    throw new Error("パスワードは数字4桁で入力してください");
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (groupError || !group) {
    throw new Error("グループが登録されていません");
  }

  const { data: sameEmail } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (sameEmail) {
    throw new Error("このメールアドレスはすでに登録されています");
  }

  const { error } = await supabase.from("profiles").insert({
    group_id: group.id,
    role: "user",
    name,
    email,
    login_code: loginCode,
    is_approved: false,
    is_active: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  redirect("/register/thanks");
}

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold">会員登録</h1>

        <p className="mt-2 text-sm text-gray-600">
          登録後、管理者の承認が完了するとログインできるようになります。
        </p>

        <form
          action={registerMember}
          className="mt-6 space-y-4 rounded-lg bg-white p-6 shadow"
        >
          <div>
            <label className="block text-sm font-medium">名前</label>
            <input
              name="name"
              required
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="例：山田太郎"
            />
            <p className="mt-1 text-xs text-gray-500">
              名前内の空白は自動削除されます。
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium">メールアドレス</label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="example@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              パスワード 4桁
            </label>
            <input
              name="login_code"
              required
              inputMode="numeric"
              maxLength={4}
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="例：1234"
            />
          </div>

          <button className="w-full rounded bg-black px-4 py-2 text-white">
            登録申請する
          </button>
        </form>

        <a
          href="/login"
          className="mt-6 inline-block text-sm text-gray-600 underline"
        >
          ログイン画面に戻る
        </a>
      </div>
    </main>
  );
}