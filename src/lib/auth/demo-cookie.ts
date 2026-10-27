import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The laptop demo's stand-in sign-in: a cookie naming whose sign-in this
 * browser uses, signed so it can't be edited by hand. Live sign-ins are
 * Supabase's own cookies; this is never used when Supabase is configured.
 */

const secret = () => process.env.LEDGERLINE_SESSION_SECRET || "ledgerline-laptop-demo";
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

export const demoCookieFor = (authId: string) => `${authId}.${sign(authId)}`;

/** The sign-in a demo cookie names, if it is genuine; "out" after signing out; null when there is none. */
export function readDemoCookie(value: string | undefined): string | "out" | null {
  if (!value) return null;
  if (value === "out") return "out";
  const [authId, signature] = value.split(".");
  if (!authId || !signature || !/^[0-9a-f-]{36}$/i.test(authId)) return "out";
  const expected = Buffer.from(sign(authId)), given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? authId : "out";
}

export const DEMO_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" && process.env.LEDGERLINE_INSECURE_COOKIES !== "1", maxAge: 60 * 60 * 24 * 30 };
