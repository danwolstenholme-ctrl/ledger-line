import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";

import { seedDemo } from "@/lib/db/seed";

/**
 * The embedded Postgres. One instance per process, kept on globalThis because
 * the dev server reloads modules; persisted to .data/ledgerline. The schema
 * and the demo data are applied the first time the database is opened empty,
 * and again whenever schema.sql has changed since: it is demo data, and a
 * database made for an older schema would only fail page by page.
 */

const DATA_DIR = process.env.LEDGERLINE_DATA_DIR ? path.resolve(process.env.LEDGERLINE_DATA_DIR) : path.join(process.cwd(), ".data", "ledgerline");
type Holder = { __ledgerline?: Promise<PGlite> };
const holder = globalThis as unknown as Holder;

const isoInstant = (value: string) => {
  const text = value.replace(" ", "T");
  return new Date(/[+-]\d\d$/.test(text) ? `${text}:00` : text).toISOString();
};

async function open(): Promise<PGlite> {
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const pg = await PGlite.create(DATA_DIR, {
    parsers: {
      [types.DATE]: (value: string) => value,
      [types.TIMESTAMPTZ]: isoInstant,
      [types.TIMESTAMP]: isoInstant,
      [types.NUMERIC]: (value: string) => Number(value),
      [types.INT8]: (value: string) => Number(value),
    },
  });
  const existing = await pg.query<{ ready: string | null; meta: string | null }>("select to_regclass('public.practices')::text as ready, to_regclass('public.ledgerline_meta')::text as meta");
  if (!existing.rows[0]?.ready) await install(pg);
  else {
    const stored = existing.rows[0].meta ? (await pg.query<{ value: string }>("select value from ledgerline_meta where key = 'schema'")).rows[0]?.value : null;
    if (stored !== schemaVersion()) {
      console.log("[db] the schema has changed since this demo data was made: making it again");
      await pg.exec("drop schema public cascade; create schema public;");
      await install(pg);
    }
  }
  await actAsDemoUser(pg);
  return pg;
}

/** One person uses the demo: the audit trail names them on everything done after the demo data is made. */
async function actAsDemoUser(pg: PGlite) {
  await pg.query("select set_config('ledgerline.actor', coalesce((select name from app_users order by name limit 1), 'system'), false)");
}

const schemaText = () => fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema.sql"), "utf8");
const schemaVersion = () => createHash("sha256").update(schemaText()).digest("hex").slice(0, 16);

async function install(pg: PGlite) {
  const started = Date.now();
  try {
    // What the demo data itself posts is the system's doing, not the user's.
    await pg.query("select set_config('ledgerline.actor', 'system', false)");
    await pg.exec(schemaText());
    await seedDemo(pg);
    await pg.query("create table ledgerline_meta (key text primary key, value text not null)");
    await pg.query("insert into ledgerline_meta (key, value) values ('schema', $1)", [schemaVersion()]);
  } catch (error) {
    // Never leave a half-built database behind: the next open starts again.
    await pg.exec("drop schema public cascade; create schema public;");
    throw error;
  }
  console.log(`[db] demo data ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

export function db() {
  holder.__ledgerline ??= open().catch(error => { holder.__ledgerline = undefined; throw error; });
  return holder.__ledgerline;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const pg = await db();
  const result = await pg.query<T>(text, params);
  return result.rows;
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await sql<T>(text, params))[0] ?? null;
}

/** Several statements that stand or fall together. */
export async function transaction<T>(work: (run: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const pg = await db();
  return pg.transaction(async tx => work(async <R,>(text: string, params: unknown[] = []) => (await tx.query<R>(text, params)).rows));
}

/** Throw the demo away and start again from the seed. */
export async function resetDemo() {
  const pg = await db();
  await pg.exec("drop schema public cascade; create schema public;");
  await install(pg);
  await actAsDemoUser(pg);
}

export type DbError = { code?: string; message: string };
export function asDbError(error: unknown): DbError {
  if (error && typeof error === "object" && "message" in error) return { code: (error as { code?: string }).code, message: String((error as { message: unknown }).message) };
  return { message: String(error) };
}
