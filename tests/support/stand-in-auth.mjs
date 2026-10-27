/**
 * A stand-in for Supabase Auth, for testing Ledgerline's sign-in wiring
 * without a Supabase project: the handful of endpoints Ledgerline's code
 * calls through @supabase/supabase-js and @supabase/ssr (password sign-in,
 * refresh, the user, sign-out, the password-reset email, the admin's
 * createUser), answering as Supabase Auth does, with HS256 tokens. Users are
 * kept in auth.users in a real Postgres, so the trigger that links a sign-in
 * to a Ledgerline person runs for real.
 *
 * It is not Supabase: it proves Ledgerline's side of the conversation, not
 * Supabase's. Before go-live, run the same tests against a Supabase project.
 *
 *   DATABASE_URL=postgres://… STAND_IN_JWT_SECRET=… node tests/support/stand-in-auth.mjs [port]
 *   node tests/support/stand-in-auth.mjs --keys   (prints the publishable and secret keys for that secret)
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import http from "node:http";
import pg from "pg";

const SECRET = process.env.STAND_IN_JWT_SECRET ?? "stand-in-secret-for-ledgerline-tests-only-0000";
const b64 = value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const jwt = payload => { const head = b64({ alg: "HS256", typ: "JWT" }), body = b64(payload); return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`; };
const verify = token => {
  const [head, body, signature] = String(token ?? "").split(".");
  if (!head || !body || !signature) return null;
  const expected = Buffer.from(createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url"));
  if (expected.length !== Buffer.byteLength(signature) || !timingSafeEqual(expected, Buffer.from(signature))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  return payload.exp && payload.exp < Date.now() / 1000 ? null : payload;
};
export const keys = () => ({ publishable: jwt({ role: "anon", iss: "stand-in", iat: 1 }), secret: jwt({ role: "service_role", iss: "stand-in", iat: 1 }) });

if (process.argv.includes("--keys")) { console.log(JSON.stringify(keys())); process.exit(0); }

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
await db.query(`create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text unique not null, encrypted_password text, raw_user_meta_data jsonb not null default '{}',
    email_confirmed_at timestamptz, last_sign_in_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);

const hash = password => { const salt = randomBytes(16); return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`; };
const matches = (password, stored) => { if (!stored) return false; const [salt, digest] = stored.split(":"); const given = scryptSync(password, Buffer.from(salt, "hex"), 32); return timingSafeEqual(given, Buffer.from(digest, "hex")); };
const userJson = row => ({ id: row.id, aud: "authenticated", role: "authenticated", email: row.email, email_confirmed_at: row.email_confirmed_at, confirmed_at: row.email_confirmed_at, phone: "",
  last_sign_in_at: row.last_sign_in_at, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: row.raw_user_meta_data ?? {}, identities: [], created_at: row.created_at, updated_at: row.updated_at, is_anonymous: false });
const refreshTokens = new Map();
const session = row => {
  const now = Math.floor(Date.now() / 1000), sessionId = randomUUID(), refresh = randomBytes(24).toString("base64url");
  refreshTokens.set(refresh, row.id);
  return { access_token: jwt({ sub: row.id, aud: "authenticated", role: "authenticated", email: row.email, session_id: sessionId, iat: now, exp: now + 3600, aal: "aal1", amr: [{ method: "password", timestamp: now }], is_anonymous: false }),
    token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(row) };
};
const failure = (status, code, message) => ({ status, body: { code, error_code: code, msg: message, message } });

async function handle(method, path, query, headers, body) {
  const bearer = (headers.authorization ?? "").replace(/^Bearer /i, "");
  if (method === "POST" && path === "/token" && query.get("grant_type") === "password") {
    const row = (await db.query("select * from auth.users where email = lower($1)", [body.email ?? ""])).rows[0];
    if (!row || !matches(body.password ?? "", row.encrypted_password)) return failure(400, "invalid_credentials", "Invalid login credentials");
    await db.query("update auth.users set last_sign_in_at = now() where id = $1", [row.id]);
    return { status: 200, body: session(row) };
  }
  if (method === "POST" && path === "/token" && query.get("grant_type") === "refresh_token") {
    const id = refreshTokens.get(body.refresh_token);
    const row = id && (await db.query("select * from auth.users where id = $1", [id])).rows[0];
    if (!row) return failure(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    refreshTokens.delete(body.refresh_token);
    return { status: 200, body: session(row) };
  }
  if (path === "/user") {
    const claims = verify(bearer);
    const row = claims?.sub && (await db.query("select * from auth.users where id = $1", [claims.sub])).rows[0];
    if (!row) return failure(401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    if (method === "PUT" && body.password) await db.query("update auth.users set encrypted_password = $2, updated_at = now() where id = $1", [row.id, hash(body.password)]);
    return { status: 200, body: userJson(row) };
  }
  if (method === "POST" && path === "/logout") return { status: 204, body: null };
  if (method === "POST" && path === "/recover") return { status: 200, body: {} };
  if (method === "POST" && path === "/admin/users") {
    if (verify(bearer)?.role !== "service_role") return failure(403, "not_admin", "User not allowed");
    const email = String(body.email ?? "").toLowerCase();
    if ((await db.query("select 1 from auth.users where email = $1", [email])).rows.length) return failure(422, "email_exists", "A user with this email address has already been registered");
    const row = (await db.query(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, $4, case when $5 then now() end) returning *`,
      [randomUUID(), email, body.password ? hash(body.password) : null, JSON.stringify(body.user_metadata ?? {}), Boolean(body.email_confirm)])).rows[0];
    return { status: 200, body: userJson(row) };
  }
  return failure(404, "not_found", `The stand-in has no ${method} ${path}`);
}

const port = Number(process.argv[2] ?? 54321);
http.createServer((request, response) => {
  let raw = "";
  request.on("data", chunk => { raw += chunk; });
  request.on("end", async () => {
    const url = new URL(request.url ?? "/", "http://stand-in");
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    try {
      const { status, body } = await handle(request.method ?? "GET", path, url.searchParams, request.headers, raw ? JSON.parse(raw) : {});
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body === null ? undefined : JSON.stringify(body));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "unexpected_failure", msg: String(error) }));
    }
  });
}).listen(port, "127.0.0.1", () => console.log(`Stand-in Supabase Auth on http://127.0.0.1:${port}/auth/v1`));
