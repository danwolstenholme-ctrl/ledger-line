/**
 * How people sign in. With a Supabase project configured, Supabase Auth:
 * email and password, with a link to reset it. Without one (the laptop demo),
 * the demo's own people, picked from a list: no passwords, because there is
 * nothing real to protect. Client-safe: no secrets here.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const AUTH_MODE: "supabase" | "demo" = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? "supabase" : "demo";
/**
 * The demo on a host, open to anyone with its address: Vercel with no
 * database of its own. Its data is made up and starts again with each new
 * server, and documents are read from the recordings of the demo files
 * (lib/capture), so it costs nothing however many people try it. Known on
 * the server only.
 */
export const HOSTED_DEMO = AUTH_MODE === "demo" && Boolean(process.env.VERCEL) && !process.env.DATABASE_URL && !process.env.POSTGRES_URL;

/** The demo's sign-in: whose stand-in sign-in this browser uses, or "out". */
export const DEMO_COOKIE = "ll_demo_session";

/** What anyone may open without signing in: signing in itself, an invitation, a client's private link, a subscribed calendar, the website form and its API, what a phone needs to install the app, and a document shared with its customer. */
const PUBLIC = [/^\/sign-in$/, /^\/join\/[^/]+$/, /^\/auth\/callback$/, /^\/account\/password$/, /^\/o\//, /^\/f\//, /^\/ics\/[^/]+$/, /^\/api\/v1\//, /^\/api\/health$/, /^\/api\/icon$/,
  /^\/manifest\.webmanifest$/, /^\/icons\/[a-z0-9-]+\.png$/, /^\/d\/[A-Za-z0-9_-]{32}(\/pdf)?$/];
export const isPublicPath = (path: string) => PUBLIC.some(pattern => pattern.test(path));

/** Where to go after signing in: a path inside Ledgerline, never another site. */
export const safeNext = (value: string | null | undefined) => value && /^\/(?!\/)[^\s]*$/.test(value) && !value.startsWith("/sign-in") ? value : "/";
