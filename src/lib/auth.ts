import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { sessionCookieName, hashSessionToken } from "@/lib/session";

export type CurrentProfile = {
  id: string;
  group_id: string;
  role: "admin" | "user";
  name: string;
  email: string;
};

export async function getCurrentProfile() {
  const cookieStore = await cookies();
  const tokenHash = hashSessionToken(cookieStore.get(sessionCookieName())?.value);

  if (!tokenHash) {
    return null;
  }

  const { data, error } = await supabase.rpc("get_app_session_profile", { p_token_hash: tokenHash });

  if (error || !data?.[0]) {
    return null;
  }

  return data[0] as CurrentProfile;
}

export async function endSession() {
  const cookieStore = await cookies();
  const tokenHash = hashSessionToken(cookieStore.get(sessionCookieName())?.value);
  if (tokenHash) {
    const { error } = await supabase.from("app_sessions").delete().eq("token_hash", tokenHash);
    if (error) throw new Error("ログアウトに失敗しました。もう一度お試しください。");
  }
  cookieStore.set(sessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  cookieStore.delete("profile_id");
}

export async function requireLogin() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return profile;
}

export async function requireAdmin() {
  const profile = await requireLogin();

  if (profile.role !== "admin") {
    redirect("/user");
  }

  return profile;
}

export async function requireUser() {
  const profile = await requireLogin();

  return profile;
}
