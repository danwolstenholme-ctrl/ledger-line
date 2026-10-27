/**
 * Supabase's baseline migration is schema.sql, word for word, as it was when
 * Ledgerline went live (28 October 2026, on the Supabase project Ledger Line,
 * where it and the accounts migration are recorded as applied).
 *
 * A live database is migrated, never rebuilt: every change to the schema now
 * goes in a new, dated file in supabase/migrations, and schema.sql follows it,
 * so this refuses to rewrite the baseline unless told to (only for a database
 * that is thrown away):
 *
 *   LEDGERLINE_BASELINE_UNLOCK=1 npm run supabase:migration
 */
import fs from "node:fs";
import path from "node:path";

if (process.env.LEDGERLINE_BASELINE_UNLOCK !== "1") {
  console.error("Ledgerline is live: the baseline migration is applied and must not change.\nAdd a new dated migration in supabase/migrations for the change, and make schema.sql match it.");
  process.exit(1);
}

const root = path.join(import.meta.dirname, "..");
const schema = fs.readFileSync(path.join(root, "src", "lib", "db", "schema.sql"), "utf8");
const target = path.join(root, "supabase", "migrations", "20261026120000_ledgerline_baseline.sql");
const header = `-- Ledgerline's baseline schema: generated from src/lib/db/schema.sql by scripts/make-supabase-migration.mjs.
-- Do not edit here. Before go-live, change schema.sql and run npm run supabase:migration; after it, add a new migration.\n\n`;
fs.writeFileSync(target, header + schema);
console.log(`Wrote ${path.relative(root, target)} (${(Buffer.byteLength(header + schema) / 1024).toFixed(0)} KB) from schema.sql.`);
