"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_MODE, DEMO_COOKIE, safeNext } from "@/lib/auth/config";
import { DEMO_COOKIE_OPTIONS, demoCookieFor } from "@/lib/auth/demo-cookie";
import { passwordProblem } from "@/lib/auth/password";
import { supabaseServer } from "@/lib/auth/supabase";
import { asService, one } from "@/lib/db";
import { idleState, type ActionState } from "@/lib/actions/state";

/**
 * Signing in and out. Live, Supabase Auth: email and password, and a link to
 * set a new one. In the laptop demo, choosing who to be from a list.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The demo: become one of its people. Never available when Supabase is configured. */
export async function signInAs(form: FormData) {
  if (AUTH_MODE !== "demo") redirect("/sign-in");
  const email = String(form.get("email") ?? "").toLowerCase();
  const person = await asService("the demo's sign-in list", () => one<{ auth_id: string | null }>("select auth_id from app_users where email = $1", [email]));
  if (!person?.auth_id) redirect("/sign-in?problem=unknown");
  (await cookies()).set(DEMO_COOKIE, demoCookieFor(person.auth_id), DEMO_COOKIE_OPTIONS);
  redirect(safeNext(String(form.get("next") ?? "")));
}

/** Supabase: email and password. */
export async function signInWithPassword(_previous: ActionState, form: FormData): Promise<ActionState> {
  if (AUTH_MODE !== "supabase") return { ok: false, error: "Sign in from the list." };
  const email = String(form.get("email") ?? "").trim().toLowerCase(), password = String(form.get("password") ?? "");
  if (!EMAIL.test(email) || !password) return { ok: false, error: "Enter your email address and your password." };
  const { error } = await (await supabaseServer()).auth.signInWithPassword({ email, password });
  // The same words for a wrong password and an unknown address: which addresses have accounts is nobody's business.
  if (error) return { ok: false, error: error.status === 429 ? "Too many tries. Wait a minute and try again." : "That email address and password don't match an account." };
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function signOut() {
  if (AUTH_MODE === "supabase") await (await supabaseServer()).auth.signOut();
  else (await cookies()).set(DEMO_COOKIE, "out", DEMO_COOKIE_OPTIONS);
  redirect("/sign-in");
}

/** Supabase: a link to set a new password, sent to the address if it has an account. The answer never says whether it does. */
export async function sendPasswordLink(_previous: ActionState, form: FormData): Promise<ActionState> {
  if (AUTH_MODE !== "supabase") return idleState;
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter the email address you sign in with." };
  const origin = await siteOrigin();
  await (await supabaseServer()).auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/account/password` });
  return { ok: true, error: null, notice: "If there's an account for that address, a link to set a new password is on its way." };
}

/** Supabase: the new password, once the emailed link has signed the person in. */
export async function setNewPassword(_previous: ActionState, form: FormData): Promise<ActionState> {
  if (AUTH_MODE !== "supabase") return idleState;
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem, fieldErrors: { password: problem } };
  const { error } = await (await supabaseServer()).auth.updateUser({ password });
  if (error) return { ok: false, error: "That link has expired. Ask for a new one from the sign-in page." };
  redirect("/");
}

async function siteOrigin() {
  const fromEnv = process.env.LEDGERLINE_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = (await headers()).get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}
