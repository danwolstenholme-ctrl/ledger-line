"use server";

import { revalidatePath } from "next/cache";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { describeDbError } from "@/lib/actions/form";
import { IMPORT_KINDS, readImportRow, type ImportKind } from "@/lib/domain/imports";
import { requireOrg } from "@/lib/org";

export type ImportState = { ok: boolean; error: string | null; added?: number; skipped?: string[]; problems?: { row: number; problem: string }[] };

/**
 * Add the spreadsheet's rows as customers, suppliers or products. Each row is
 * read again here exactly as the preview read it; one already in the company
 * (the same name, VAT number or code) is left alone, and nothing is
 * overwritten.
 */
export async function importRecords(_previous: ImportState, form: FormData): Promise<ImportState> {
  const org = await requireOrg();
  const kind = String(form.get("kind")) as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) return { ok: false, error: "That is not something that can be imported." };
  let mapping: Record<string, number | null>, rows: string[][];
  try {
    mapping = JSON.parse(String(form.get("mapping") ?? "{}"));
    rows = JSON.parse(String(form.get("rows") ?? "[]"));
  } catch { return { ok: false, error: "The file could not be read. Choose it again." }; }
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "There are no rows to import." };
  if (rows.length > 2000) return { ok: false, error: "Import up to 2,000 rows at a time." };
  const table = kind === "items" ? "items" : kind;
  const existing = await sql<{ name: string; vat_number: string | null; code: string | null }>(
    kind === "items" ? "select lower(btrim(name)) as name, null as vat_number, lower(btrim(code)) as code from items where organisation_id = $1 and is_active"
      : `select lower(btrim(name)) as name, upper(vat_number) as vat_number, null as code from ${table} where organisation_id = $1`, [org.id]);
  const names = new Set(existing.map(row => row.name)), vats = new Set(existing.map(row => row.vat_number).filter(Boolean)), codes = new Set(existing.map(row => row.code).filter(Boolean));
  const accounts = kind === "items" ? await sql<{ id: string; code: string }>("select id, code from ledger_accounts where organisation_id = $1 and is_active and type in ('revenue', 'other_income')", [org.id]) : [];
  const sales = (await one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [org.id]))?.id ?? null;
  const problems: { row: number; problem: string }[] = [], skipped: string[] = [], ready: Record<string, string | number | boolean | null>[] = [];
  rows.forEach((cells, index) => {
    const read = readImportRow(kind, Array.isArray(cells) ? cells.map(String) : [], mapping, index + 2);
    if (read.problem) { problems.push({ row: read.row, problem: read.problem }); return; }
    const values = read.values;
    const name = String(values.name).trim().toLowerCase(), vat = values.vat_number ? String(values.vat_number) : null, code = values.code ? String(values.code).toLowerCase() : null;
    if (names.has(name) || (vat && vats.has(vat)) || (code && codes.has(code))) { skipped.push(String(values.name)); return; }
    if (kind === "items") {
      const account = values.account ? accounts.find(item => item.code === String(values.account))?.id : sales;
      if (!account) { problems.push({ row: read.row, problem: `No income account with code ${values.account}` }); return; }
      values.account_id = account;
    }
    names.add(name); if (vat) vats.add(vat); if (code) codes.add(code);
    ready.push(values);
  });
  if (ready.length) {
    try {
      await transaction(async run => {
        for (const values of ready) {
          if (kind === "customers") await run("insert into customers (organisation_id, name, email, phone, vat_number, country, address, payment_terms_days, eu_business, default_account_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
            [org.id, values.name, values.email, values.phone, values.vat_number, values.country, values.address, values.payment_terms_days, values.eu_business, sales]);
          else if (kind === "suppliers") await run("insert into suppliers (organisation_id, name, email, phone, vat_number, country, iban, bic) values ($1, $2, $3, $4, $5, $6, $7, $8)",
            [org.id, values.name, values.email, values.phone, values.vat_number, values.country, values.iban, values.bic]);
          else await run("insert into items (organisation_id, name, code, unit, unit_price, vat_rate, account_id) values ($1, $2, $3, $4, $5, $6, $7)",
            [org.id, values.name, values.code, values.unit, values.unit_price, values.vat_rate, values.account_id]);
        }
      });
    } catch (error) {
      const failure = asDbError(error);
      console.error("[imports] import failed", failure.code);
      return { ok: false, error: describeDbError(failure, "The import could not be saved. Nothing was added."), problems, skipped };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, error: null, added: ready.length, skipped, problems };
}
