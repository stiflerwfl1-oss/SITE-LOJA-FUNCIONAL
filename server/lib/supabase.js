import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.js";

let cached = null;

export function getSupabaseClient() {
  if (cached) return cached;
  const url = requireEnv("SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cached;
}
