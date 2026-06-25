import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import SubmitButton from "@/components/SubmitButton";

import {
  updateMemberLoginEnabled,
  updateMemberProfile,
  updateMemberRole,
} from "./actions";

type Profile = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  login_code: string | null;
  login_enabled: boolean;
  created_at: string;
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

function roleLabel(role: string) {
  return role === "admin" ? "管理者" : "一般ユーザー";
}

export default async function AdminMembersPage() {
  const admin = await requireAdmin();

  const { data: members, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, login_code, login_enabled, created_at")
    .eq("group_id", admin.group_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const memberList = (members ?? []) as Profile[];

  const pendingMembers = memberList.filter((member) => !member.login_enabled);
  const activeMembers = memberList.filter((member) => member.login_enabled);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">会員管理</h1>
            <p className="mt-3 text-base font-medium text-gray-700">
              会員登録の承認、登録情報編集、管理者権限、ログイン許可を管理します。
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/admin"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              管理者画面に戻る
            </a>

            <a
              href="/logout"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              ログアウト
            </a>
          </div>
        </div>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <h2 className="text-xl font-bold text-gray-900">承認待ち</h2>
          <p className="mt-2 text-sm font-medium text-gray-700">
            ログイン許可がない会員です。承認するとログイン可能になります。
          </p>

          {pendingMembers.length === 0 ? (
            <p className="mt-4 rounded bg-gray-50 p-4 font-medium text-gray-700">
              承認待ちの会員はいません。
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {pendingMembers.map((member) => (
                <article
                  key={member.id}
                  className="rounded border border-gray-300 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        {member.name}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-gray-700">
                        {member.email}
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-700">
                        権限：{roleLabel(member.role)}
                      </p>
                    </div>

                    <form action={updateMemberLoginEnabled}>
                      <input type="hidden" name="member_id" value={member.id} />
                      <input type="hidden" name="login_enabled" value="true" />
                      <button className="rounded bg-green-600 px-4 py-2 font-bold text-white">
                        承認する
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <h2 className="text-xl font-bold text-gray-900">会員一覧</h2>

          <div className="mt-4 space-y-4">
            {activeMembers.map((member) => {
              const isSelf = member.id === admin.id;

              return (
                <article
                  key={member.id}
                  className="rounded border border-gray-300 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">
                        {member.name}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-gray-700">
                        {member.email}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">
                          {roleLabel(member.role)}
                        </span>

                        <span className="rounded bg-green-100 px-3 py-1 text-sm font-bold text-green-800">
                          ログイン許可
                        </span>

                        {isSelf && (
                          <span className="rounded bg-gray-200 px-3 py-1 text-sm font-bold text-gray-800">
                            自分自身
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <details className="mt-5 rounded bg-gray-50 p-4">
                    <summary className="cursor-pointer font-bold text-gray-900">
                      登録情報を編集
                    </summary>

                    <form action={updateMemberProfile} className="mt-4 grid gap-3 sm:grid-cols-3">
                      <input type="hidden" name="member_id" value={member.id} />

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          名前
                        </label>
                        <input
                          name="name"
                          defaultValue={member.name}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          メールアドレス
                        </label>
                        <input
                          name="email"
                          type="email"
                          defaultValue={member.email}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          4桁コード
                        </label>
                        <input
                          name="login_code"
                          inputMode="numeric"
                          maxLength={4}
                          defaultValue={member.login_code ?? ""}
                          className={fieldClass}
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <SubmitButton
                          pendingText="更新中・・・"
                          className="rounded bg-black px-4 py-3 font-bold text-white"
                        >
                          登録情報を更新
                        </SubmitButton>
                      </div>
                    </form>
                  </details>

                  <details className="mt-4 rounded bg-gray-50 p-4">
                    <summary className="cursor-pointer font-bold text-gray-900">
                      権限・ログイン許可
                    </summary>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {member.role === "admin" ? (
                        <form action={updateMemberRole}>
                          <input type="hidden" name="member_id" value={member.id} />
                          <input type="hidden" name="role" value="user" />
                          <SubmitButton
                            disabled={isSelf}
                            pendingText="処理中・・・"
                            className="w-full rounded bg-gray-700 px-4 py-3 font-bold text-white disabled:opacity-40"
                          >
                            管理者権限を削除
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={updateMemberRole}>
                          <input type="hidden" name="member_id" value={member.id} />
                          <input type="hidden" name="role" value="admin" />
                          <button className="w-full rounded bg-blue-600 px-4 py-3 font-bold text-white">
                            管理者権限を付与
                          </button>
                        </form>
                      )}

                      <form action={updateMemberLoginEnabled}>
                        <input type="hidden" name="member_id" value={member.id} />
                        <input type="hidden" name="login_enabled" value="false" />
                        <button
                          disabled={isSelf}
                          className="w-full rounded bg-red-600 px-4 py-3 font-bold text-white disabled:opacity-40"
                        >
                          ログイン不可にする
                        </button>
                      </form>
                    </div>

                    {isSelf && (
                      <p className="mt-3 rounded bg-yellow-100 p-3 text-sm font-bold text-yellow-800">
                        自分自身の管理者権限とログイン許可は削除できません。
                      </p>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
