import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseEnvironment } from "@/lib/environment";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required");
}

if (!supabaseSecretKey) {
  throw new Error("SUPABASE_SECRET_KEY is required on the server");
}

assertDatabaseEnvironment(supabaseUrl, process.env.NODE_ENV, process.env.VERCEL_ENV);

export const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
