/**
 * Supabase's baseline migration is schema.sql, word for word. Until
 * Ledgerline is live, run this after changing schema.sql:
 *
 *   npm run supabase:migration
 *
 * Once a live database exists, stop: from then on every change to the
 * schema goes in a new, dated file in supabase/migrations, and schema.sql
 * follows it, because a live database is migrated, never rebuilt.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const schema = fs.readFileSync(path.join(root, "src", "lib", "db", "schema.sql"), "utf8");
const target = path.join(root, "supabase", "migrations", "20261026120000_ledgerline_baseline.sql");
const header = `-- Ledgerline's baseline schema: generated from src/lib/db/schema.sql by scripts/make-supabase-migration.mjs.
-- Do not edit here. Before go-live, change schema.sql and run npm run supabase:migration; after it, add a new migration.\n\n`;
fs.writeFileSync(target, header + schema);
console.log(`Wrote ${path.relative(root, target)} (${(Buffer.byteLength(header + schema) / 1024).toFixed(0)} KB) from schema.sql.`);
