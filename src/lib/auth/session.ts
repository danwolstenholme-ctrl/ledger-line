import "server-only";

import { cookies } from "next/headers";

import { AUTH_MODE, DEMO_COOKIE } from "@/lib/auth/config";
import { readDemoCookie } from "@/lib/auth/demo-cookie";
import { supabaseServer } from "@/lib/auth/supabase";

/**
 * Who is signed in to this request, checked properly: Supabase's session
 * verified with getClaims() (the proxy only refreshes it and redirects), or
 * the demo's signed cookie. Worked out once per request. "default" means the
 * laptop demo with nobody chosen yet: its own user. Outside a request (a
 * script), nobody, except in the demo.
 */
export type SignedIn = string | "default" | null;

const verified = new WeakMap<object, Promise<SignedIn>>();

export async function signedIn(): Promise<SignedIn> {
  let store: Awaited<ReturnType<typeof cookies>>;
  try { store = await cookies(); } catch { return AUTH_MODE === "demo" ? "default" : null; }
  let found = verified.get(store);
  if (!found) {
    found = check(store);
    verified.set(store, found);
  }
  return found;
}

async function check(store: Awaited<ReturnType<typeof cookies>>): Promise<SignedIn> {
  if (AUTH_MODE === "demo") {
    const demo = readDemoCookie(store.get(DEMO_COOKIE)?.value);
    return demo === null ? "default" : demo === "out" ? null : demo;
  }
  const { data, error } = await (await supabaseServer()).auth.getClaims();
  return error || !data?.claims?.sub ? null : data.claims.sub;
}
