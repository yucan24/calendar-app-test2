import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

async function login(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").replace(/\s+/g, "");
  const loginCode = String(formData.get("login_code") ?? "").trim();

  if (!name || !loginCode) {
    throw new Error("名前と4桁コードを入力してください");
  }

  if (!/^\d{4}$/.test(loginCode)) {
    throw new Error("4桁コードは数字4桁で入力してください");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, is_approved, is_active")
    .eq("name", name)
    .eq("login_code", loginCode)
    .eq("is_approved", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!profile) {
    throw new Error("名前または4桁コードが違うか、まだ承認されていません");
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

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold">ログイン</h1>
        <p className="mt-2 text-sm text-gray-600">
          名前と4桁コードを入力してください。
        </p>

        <form action={login} className="mt-6 space-y-4 rounded-lg bg-white p-6 shadow">
          <div>
            <label className="block text-sm font-medium">名前</label>
            <input
              name="name"
              required
              className="mt-1 w-full rounded border px-3 py-2"
              placeholder="例：山田太郎"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">4桁コード</label>
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
            ログイン
          </button>

          <a
            href="/register"
            className="mt-6 block text-center text-sm text-gray-600 underline"
          >
            会員登録はこちら
          </a>
        </form>
      </div>
    </main>
  );
}