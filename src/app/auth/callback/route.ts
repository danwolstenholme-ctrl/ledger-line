import { NextResponse } from "next/server";

import { AUTH_MODE, safeNext } from "@/lib/auth/config";
import { supabaseServer } from "@/lib/auth/supabase";

export const dynamic = "force-dynamic";

/** Where Supabase's emailed links land: the one-time code becomes a session, then on to where the link was going. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (AUTH_MODE !== "supabase" || !code) return NextResponse.redirect(new URL("/sign-in", url));
  const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/sign-in?problem=link" : next, url));
}
