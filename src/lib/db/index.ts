import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import pg from "pg";

import { signedIn } from "@/lib/auth/session";
import { seedDemo } from "@/lib/db/seed";

/**
 * The database, and who is asking it.
 *
 * On the laptop it is an embedded Postgres (PGlite) in .data/ledgerline,
 * built from schema.sql and the demo data, and built again whenever
 * schema.sql changes. Live, DATABASE_URL points at Supabase's Postgres, whose
 * schema comes from supabase/migrations; the demo data is only put there when
 * LEDGERLINE_DEMO_DATA=1 (a throwaway database for testing).
 *
 * Every query made for a person runs inside a transaction as the role
 * `authenticated`, with their id in request.jwt.claims, exactly as Supabase
 * runs a signed-in request: row-level security in schema.sql decides what
 * they see. Work done for nobody in particular (a client's private link, the
 * website form, the seed, a nightly job) runs as the database's owner, and
 * only inside asService(), so each such place is visible in the code.
 */

/**
 * Where the embedded database keeps its files: .data/ledgerline, or
 * LEDGERLINE_DATA_DIR. A host whose app folder is read-only (Vercel) keeps
 * them in its temporary folder: the hosted demo, made afresh on each new
 * server and kept only while that server runs.
 */
function dataDir() {
  if (process.env.LEDGERLINE_DATA_DIR) return path.resolve(process.env.LEDGERLINE_DATA_DIR);
  const local = path.join(process.cwd(), ".data", "ledgerline");
  try {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.accessSync(path.dirname(local), fs.constants.W_OK);
    return local;
  } catch {
    return path.join(os.tmpdir(), "ledgerline");
  }
}
const DATA_DIR = dataDir();
/**
 * The real Postgres, when there is one: DATABASE_URL, or the POSTGRES_URL that
 * Vercel's Supabase integration sets (its transaction pooler). Its sslmode
 * means what it means to Postgres itself: "require" encrypts the connection,
 * where node-postgres would otherwise also demand a certificate it can check
 * against the public authorities, which Supabase's are not.
 */
function databaseUrl() {
  let url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return url;
  // Supabase is always reached encrypted, whether or not the address pasted in says so.
  if (/@[^/?]*\.supabase\.(com|co)(:\d+)?\//.test(url) && !/[?&]sslmode=/.test(url)) url += `${url.includes("?") ? "&" : "?"}sslmode=require`;
  if (!/[?&]sslmode=/.test(url) || /[?&]uselibpqcompat=/.test(url)) return url;
  return `${url}&uselibpqcompat=true`;
}
const DATABASE_URL = databaseUrl();
const DEMO_DATA = !DATABASE_URL || process.env.LEDGERLINE_DEMO_DATA === "1";
/** The laptop demo's person before anyone signs in: who opens it in a meeting. */
const DEMO_USER = process.env.LEDGERLINE_DEMO_USER ?? "maria@saltlake.example";

type Rows<T> = { rows: T[] };
export type Connection = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Rows<T>>;
  exec(text: string): Promise<unknown>;
  transaction<T>(work: (tx: { query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Rows<R>> }) => Promise<T>): Promise<T>;
};
type Holder = { __ledgerline?: Promise<Connection>; __ledgerlineUser?: Promise<string | null> };
const holder = globalThis as unknown as Holder;

const isoInstant = (value: string) => {
  const text = value.replace(" ", "T");
  return new Date(/[+-]\d\d$/.test(text) ? `${text}:00` : text).toISOString();
};

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

async function embedded(): Promise<Connection> {
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  return PGlite.create(DATA_DIR, {
    parsers: {
      [types.DATE]: (value: string) => value,
      [types.TIMESTAMPTZ]: isoInstant,
      [types.TIMESTAMP]: isoInstant,
      [types.NUMERIC]: (value: string) => Number(value),
      [types.INT8]: (value: string) => Number(value),
    },
  }) as Promise<Connection>;
}

/** Values come back as the embedded database gives them: dates as text, instants as ISO, numbers as numbers. */
const PG_TYPES = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === 1082) return (value: string) => value;
    if (oid === 1184 || oid === 1114) return isoInstant;
    if (oid === 1700 || oid === 20) return (value: string) => Number(value);
    return pg.types.getTypeParser(oid, format);
  },
} as pg.CustomTypesConfig;

function clientConnection(client: pg.PoolClient | pg.Pool): Connection {
  const query = async <T,>(text: string, params?: unknown[]) => ({ rows: (await client.query({ text, values: params, types: PG_TYPES })).rows as T[] });
  return {
    query,
    exec: text => client.query(text),
    async transaction(work) {
      const own = "release" in client ? client : await (client as pg.Pool).connect();
      try {
        await own.query("begin");
        const result = await work({ query: async <R,>(text: string, params?: unknown[]) => ({ rows: (await own.query({ text, values: params, types: PG_TYPES })).rows as R[] }) });
        await own.query("commit");
        return result;
      } catch (error) {
        await own.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        if (own !== client) (own as pg.PoolClient).release();
      }
    },
  };
}

async function postgres(): Promise<Connection> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: Number(process.env.LEDGERLINE_DB_POOL ?? 10) });
  return clientConnection(pool);
}

/** One connection held for building the demo: its session settings (who is acting, that it is seeding) hold throughout. */
async function session<T>(conn: Connection, work: (session: Connection) => Promise<T>) {
  if (!DATABASE_URL) return work(conn);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try { return await work(clientConnection(client)); } finally { client.release(); await pool.end(); }
}

async function open(): Promise<Connection> {
  const conn = DATABASE_URL ? await postgres() : await embedded();
  if (!DEMO_DATA) return conn;
  const existing = (await conn.query<{ ready: string | null; meta: string | null }>("select to_regclass('public.practices')::text as ready, to_regclass('public.ledgerline_meta')::text as meta")).rows[0];
  if (!existing?.ready) await session(conn, install);
  else {
    const stored = existing.meta ? (await conn.query<{ value: string }>("select value from ledgerline_meta where key = 'schema'")).rows[0]?.value : null;
    if (stored !== schemaVersion() || process.env.LEDGERLINE_RESET_ON_START === "1") {
      console.log(stored !== schemaVersion() ? "[db] the schema has changed since this demo data was made: making it again" : "[db] starting from fresh demo data");
      await session(conn, async own => { await own.exec("drop schema public cascade; create schema public;"); await install(own); });
    }
  }
  return conn;
}

const schemaText = () => fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const schemaVersion = () => createHash("sha256").update(schemaText()).digest("hex").slice(0, 16);

async function install(conn: Connection) {
  const started = Date.now();
  try {
    // What the demo data itself posts is the system's doing, not a person's.
    await conn.query("select set_config('ledgerline.actor', 'system', false)");
    await conn.exec(schemaText());
    // On a Supabase database (or one built like it), sign-ins are linked to people as Supabase makes them.
    if ((await conn.query<{ users: string | null }>("select to_regclass('auth.users')::text as users")).rows[0]?.users) {
      const migrations = path.join(process.cwd(), "supabase", "migrations");
      for (const file of fs.readdirSync(migrations).filter(name => name.endsWith("_supabase_accounts.sql"))) await conn.exec(fs.readFileSync(path.join(migrations, file), "utf8"));
    }
    await seedDemo(conn as unknown as PGlite);
    await conn.query("create table ledgerline_meta (key text primary key, value text not null)");
    await conn.query("insert into ledgerline_meta (key, value) values ('schema', $1)", [schemaVersion()]);
    await conn.query("select set_config('ledgerline.actor', '', false)");
  } catch (error) {
    // Never leave a half-built database behind: the next open starts again.
    await conn.exec("drop schema public cascade; create schema public;");
    throw error;
  }
  console.log(`[db] demo data ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

export function db() {
  holder.__ledgerline ??= open().catch(error => { holder.__ledgerline = undefined; throw error; });
  return holder.__ledgerline;
}

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

/** A person is named by their sign-in (app_users.auth_id): what request.jwt.claims' sub carries, live and in the demo. */
type Identity = { kind: "person"; authId: string | null } | { kind: "service"; why: string };
const asking = new AsyncLocalStorage<Identity>();

/** Work done for nobody in particular, with the owner's rights: say why. Everything else runs as a person. */
export function asService<T>(why: string, work: () => Promise<T>): Promise<T> {
  return asking.run({ kind: "service", why }, work);
}
/** Work done as one particular person, by their sign-in: a job acting for them, or a test. */
export function asPerson<T>(authId: string | null, work: () => Promise<T>): Promise<T> {
  return asking.run({ kind: "person", authId }, work);
}

/** The laptop demo's own person, until someone is chosen at sign-in. */
async function demoSignIn(): Promise<string | null> {
  holder.__ledgerlineUser ??= (async () => {
    const conn = await db();
    return (await conn.query<{ auth_id: string | null }>("select auth_id from app_users where email = $1", [DEMO_USER])).rows[0]?.auth_id ?? null;
  })().catch(error => { holder.__ledgerlineUser = undefined; throw error; });
  return holder.__ledgerlineUser;
}

async function identity(): Promise<Identity> {
  const chosen = asking.getStore();
  if (chosen) return chosen;
  const who = await signedIn();
  return { kind: "person", authId: who === "default" ? await demoSignIn() : who };
}

type Run = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** A transaction as the person asking: the role Supabase gives a signed-in request, and their claims. */
async function within<T>(work: (run: Run) => Promise<T>): Promise<T> {
  const conn = await db();
  const who = await identity();
  return conn.transaction(async tx => {
    if (who.kind === "person") {
      await tx.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
        [JSON.stringify(who.authId ? { sub: who.authId, role: "authenticated" } : { role: "authenticated" })]);
    }
    return work(async <R,>(text: string, params: unknown[] = []) => (await tx.query<R>(text, params)).rows);
  });
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return within(run => run<T>(text, params));
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await sql<T>(text, params))[0] ?? null;
}

/** Several statements that stand or fall together. */
export async function transaction<T>(work: (run: Run) => Promise<T>): Promise<T> {
  return within(work);
}

/** Throw the demo away and start again from the seed. Never on a live database. */
export async function resetDemo() {
  if (!DEMO_DATA) throw new Error("Resetting is for demo data only.");
  const conn = await db();
  await session(conn, async own => { await own.exec("drop schema public cascade; create schema public;"); await install(own); });
  holder.__ledgerlineUser = undefined;
}

export type DbError = { code?: string; message: string };
export function asDbError(error: unknown): DbError {
  if (error && typeof error === "object" && "message" in error) return { code: (error as { code?: string }).code, message: String((error as { message: unknown }).message) };
  return { message: String(error) };
}
