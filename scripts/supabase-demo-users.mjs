/**
 * Sign-ins for the demo's people on a Supabase project (a staging demo, or
 * the tests' stand-in): each seeded person without one gets a confirmed
 * Supabase account with the same email, which the database links to them.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… DATABASE_URL=… LEDGERLINE_DEMO_PASSWORD=… npm run supabase:demo-users
 *
 * Never on a live database: these are the demo's invented people.
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL: url, LEDGERLINE_DEMO_PASSWORD: password } = process.env;
// Vercel's Supabase integration names the database POSTGRES_URL.
const database = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !database || !password) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL and LEDGERLINE_DEMO_PASSWORD.");
if (password.length < 10) throw new Error("LEDGERLINE_DEMO_PASSWORD needs at least 10 characters.");

// sslmode as Postgres means it ("require": encrypted), as the app connects (src/lib/db).
const db = new pg.Client({ connectionString: /[?&]sslmode=/.test(database) && !/[?&]uselibpqcompat=/.test(database) ? `${database}&uselibpqcompat=true` : database });
await db.connect();
const people = (await db.query("select name, email from app_users where auth_id is null order by name")).rows;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
for (const person of people) {
  const { error } = await admin.auth.admin.createUser({ email: person.email, password, email_confirm: true, user_metadata: { name: person.name } });
  console.log(error ? `  ${person.email}: ${error.message}` : `  ${person.email}: signs in now`);
}
const linked = (await db.query("select count(*) as n from app_users where auth_id is not null")).rows[0].n;
console.log(`${linked} people can sign in.`);
await db.end();
