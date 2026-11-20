import "server-only";
import { supabase } from "@/lib/supabase";
import { allowAuthAttempt } from "@/lib/authRateLimit";
import { createSessionToken, hashSessionToken } from "@/lib/session";

type LoginResult =
  | { ok: true; token: string; role: "admin" | "user" }
  | { ok: false; reason: "failed" | "pending" | "limited" | "unavailable" };

export async function authenticateLogin(name: string, code: string): Promise<LoginResult> {
  try {
    if (!await allowAuthAttempt("login", name)) return { ok: false, reason: "limited" };
    const token = createSessionToken();
    const { data, error } = await supabase.rpc("authenticate_app_session", {
      p_name: name,
      p_login_code: code,
      p_token_hash: hashSessionToken(token),
    });
    if (error) return { ok: false, reason: "unavailable" };
    const result = data?.[0];
    if (result?.outcome === "authenticated" && ["admin", "user"].includes(result.profile_role)) {
      return { ok: true, token, role: result.profile_role };
    }
    return { ok: false, reason: result?.outcome === "pending" ? "pending" : "failed" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
