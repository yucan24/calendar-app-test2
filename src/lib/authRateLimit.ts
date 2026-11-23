import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";

async function consume(bucket: string, limit: number, windowSeconds: number) {
  const { data, error } = await supabase.rpc("consume_auth_rate_limit", {
    p_bucket_hash: createHash("sha256").update(bucket).digest("hex"),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || typeof data !== "boolean") throw new Error("ログインの試行回数を確認できませんでした。");
  return data;
}

export async function allowAuthAttempt(action: "login" | "register" | "recovery" | "account" | "mail", name?: string) {
  const requestHeaders = await headers();
  // Vercel overwrites this header. Outside Vercel, use one shared bucket rather than trust a supplied IP.
  const forwarded = process.env.VERCEL === "1" ? requestHeaders.get("x-forwarded-for")?.split(",")[0].trim() : "local";
  const address = forwarded && isIP(forwarded) ? forwarded : "shared";
  if (!await consume(`${action}:ip:${address}`, action === "login" ? 100 : 20, action === "login" ? 900 : 3600)) return false;
  if (action === "register") return true;
  if (!name) return false;
  if (action !== "login") return consume(`${action}:account:${name}`, action === "account" ? 10 : 3, action === "account" ? 900 : 3600);
  if (!await consume(`login:account:${name}`, 5, 900)) return false;
  return consume(`login:daily:${name}`, 20, 86400);
}
