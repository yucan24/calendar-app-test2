import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

export type CurrentProfile = {
  id: string;
  group_id: string;
  role: "admin" | "user";
  name: string;
  email: string;
};

export async function getCurrentProfile() {
  const cookieStore = await cookies();
  const profileId = cookieStore.get("profile_id")?.value;

  if (!profileId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, group_id, role, name, email")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CurrentProfile;
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