import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

type Profile = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  is_approved: boolean;
  is_active: boolean;
  created_at: string;
};

async function approveUser(formData: FormData) {
  "use server";

  const currentAdmin = await requireAdmin();
  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("対象ユーザーが不明です");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      is_approved: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", currentAdmin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

async function disableLogin(formData: FormData) {
  "use server";

  const currentAdmin = await requireAdmin();
  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("対象ユーザーが不明です");
  }

  if (id === currentAdmin.id) {
    throw new Error("自分自身をログイン不可にはできません");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", currentAdmin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

async function enableLogin(formData: FormData) {
  "use server";

  const currentAdmin = await requireAdmin();
  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("対象ユーザーが不明です");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      is_active: true,
      is_approved: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", currentAdmin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

async function grantAdmin(formData: FormData) {
  "use server";

  const currentAdmin = await requireAdmin();
  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("対象ユーザーが不明です");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      role: "admin",
      is_approved: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", currentAdmin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

async function revokeAdmin(formData: FormData) {
  "use server";

  const currentAdmin = await requireAdmin();
  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("対象ユーザーが不明です");
  }

  if (id === currentAdmin.id) {
    throw new Error("自分自身の管理者権限は削除できません");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      role: "user",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("group_id", currentAdmin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

function statusLabel(profile: Profile) {
  if (!profile.is_active) return "ログイン不可";
  if (!profile.is_approved) return "承認待ち";
  return "ログイン可能";
}

function statusClass(profile: Profile) {
  if (!profile.is_active) return "bg-red-100 text-red-800";
  if (!profile.is_approved) return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
}

function roleLabel(profile: Profile) {
  return profile.role === "admin" ? "管理者" : "一般";
}

function roleClass(profile: Profile) {
  return profile.role === "admin"
    ? "rounded bg-black px-2 py-1 text-xs text-white"
    : "rounded bg-gray-100 px-2 py-1 text-xs text-gray-600";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, is_approved, is_active, created_at")
    .eq("group_id", admin.group_id)
    .order("is_approved", { ascending: true })
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold">会員管理</h1>

          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            会員取得エラー：{error.message}
          </p>

          <a
            href="/admin"
            className="mt-6 inline-block rounded border bg-white px-4 py-2"
          >
            管理者画面に戻る
          </a>
        </div>
      </main>
    );
  }

  const profileList = (profiles ?? []) as Profile[];

  const pendingProfiles = profileList.filter(
    (profile) => !profile.is_approved && profile.is_active
  );

  const activeProfiles = profileList.filter(
    (profile) => profile.is_approved && profile.is_active
  );

  const disabledProfiles = profileList.filter((profile) => !profile.is_active);

  const adminProfiles = profileList.filter(
    (profile) => profile.role === "admin" && profile.is_active
  );

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">会員管理</h1>
            <p className="mt-2 text-sm text-gray-600">
              会員承認、ログイン停止、管理者権限の付与・削除を行います。
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {admin.name} さんでログイン中
            </p>
          </div>

          <a href="/admin" className="rounded border bg-white px-4 py-2">
            管理者画面に戻る
          </a>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-white p-5 shadow">
            <p className="text-sm text-gray-500">承認待ち</p>
            <p className="mt-2 text-3xl font-bold">{pendingProfiles.length}</p>
          </div>

          <div className="rounded-lg bg-white p-5 shadow">
            <p className="text-sm text-gray-500">ログイン可能</p>
            <p className="mt-2 text-3xl font-bold">{activeProfiles.length}</p>
          </div>

          <div className="rounded-lg bg-white p-5 shadow">
            <p className="text-sm text-gray-500">ログイン不可</p>
            <p className="mt-2 text-3xl font-bold">
              {disabledProfiles.length}
            </p>
          </div>

          <div className="rounded-lg bg-white p-5 shadow">
            <p className="text-sm text-gray-500">管理者</p>
            <p className="mt-2 text-3xl font-bold">{adminProfiles.length}</p>
          </div>
        </section>

        <section className="mt-8 rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-bold">会員一覧</h2>

          <div className="mt-4 space-y-4">
            {profileList.map((profile) => {
              const isSelf = profile.id === admin.id;

              return (
                <div
                  key={profile.id}
                  className={
                    isSelf
                      ? "rounded border-2 border-black bg-gray-50 p-4"
                      : "rounded border p-4"
                  }
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-bold">{profile.name}</p>

                        {isSelf && (
                          <span className="rounded bg-black px-2 py-1 text-xs text-white">
                            自分
                          </span>
                        )}

                        <span
                          className={`rounded px-2 py-1 text-xs ${statusClass(
                            profile
                          )}`}
                        >
                          {statusLabel(profile)}
                        </span>

                        <span className={roleClass(profile)}>
                          {roleLabel(profile)}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-gray-600">
                        {profile.email}
                      </p>

                      <p className="mt-1 text-xs text-gray-500">
                        登録日：{formatDate(profile.created_at)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!profile.is_approved && profile.is_active && (
                        <form action={approveUser}>
                          <input type="hidden" name="id" value={profile.id} />
                          <button className="rounded bg-green-600 px-3 py-2 text-sm text-white">
                            承認
                          </button>
                        </form>
                      )}

                      {isSelf ? (
                        <span className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-500">
                          自分のログイン許可は変更不可
                        </span>
                      ) : profile.is_active ? (
                        <form action={disableLogin}>
                          <input type="hidden" name="id" value={profile.id} />
                          <button className="rounded border border-red-300 px-3 py-2 text-sm text-red-700">
                            ログイン不可にする
                          </button>
                        </form>
                      ) : (
                        <form action={enableLogin}>
                          <input type="hidden" name="id" value={profile.id} />
                          <button className="rounded border border-green-300 px-3 py-2 text-sm text-green-700">
                            ログイン可能に戻す
                          </button>
                        </form>
                      )}

                      {isSelf ? (
                        <span className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-500">
                          自分の管理者権限は変更不可
                        </span>
                      ) : profile.role === "admin" ? (
                        <form action={revokeAdmin}>
                          <input type="hidden" name="id" value={profile.id} />
                          <button className="rounded border px-3 py-2 text-sm">
                            管理者権限を削除
                          </button>
                        </form>
                      ) : (
                        <form action={grantAdmin}>
                          <input type="hidden" name="id" value={profile.id} />
                          <button className="rounded border px-3 py-2 text-sm">
                            管理者権限を付与
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {profileList.length === 0 && (
              <p className="rounded bg-gray-50 p-4 text-sm text-gray-600">
                会員がまだ登録されていません。
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}