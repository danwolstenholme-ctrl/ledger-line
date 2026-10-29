import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/auth/config";

/** Supabase Auth for this request, reading and writing its session cookies (Supabase's own pattern for the App Router). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // A Server Component can't set cookies; the proxy refreshes the session for it.
        try { for (const { name, value, options } of list) store.set(name, value, options); } catch { /* read-only here */ }
      },
    },
  });
}

/** Supabase Auth with the project's secret key: only for making a confirmed account for someone who opened their invitation. Server only. */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set: accounts can't be made for invitations.");
  // The two keys sit side by side in Supabase's dashboard: the publishable one makes no accounts, and says only "requires a valid Bearer token".
  if (key.startsWith("sb_publishable_")) throw new Error("SUPABASE_SECRET_KEY holds the publishable key: it needs the secret one (sb_secret_…), from Supabase's API Keys.");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
