import "server-only";

import { one, sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import type { SupplierStatementCheckRow } from "@/types/database";
import { getStatement } from "./statements";

/**
 * Checking a statement a supplier sent against the books (Xero and Sage
 * leave this to an add-on). Their balance on the statement's date is set
 * beside ours; what explains a difference is usually timing: something of
 * ours not on their statement yet (a payment still on its way), something
 * we recorded after the date that is on theirs (a bill dated when it
 * arrived), or something of theirs not in the books at all.
 */

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** What a check of their statement on `date` starts from: our balance that day, our lines in the weeks before it, and those just after. */
export async function getCheckSetup(supplierId: string, date: string) {
  const data = await getStatement("supplier", supplierId, { view: "activity", from: addDays(date, -90), to: addDays(date, 45) });
  if (!data) return null;
  const before = data.lines.filter(line => line.date <= date), after = data.lines.filter(line => line.date > date);
  const ours = before.length ? before[before.length - 1].balance : data.opening;
  const last = await one<{ id: string; statement_date: string; agreed: boolean }>(
    "select id, statement_date, agreed from supplier_statement_checks where supplier_id = $1 order by statement_date desc, created_at desc limit 1", [supplierId]);
  return { supplier: data.account, date, ours, before, after, last };
}

/** Our balance with a supplier at the end of a day: what a check is saved against, worked out again rather than taken from the page. */
export async function balanceOn(supplierId: string, date: string) {
  const data = await getStatement("supplier", supplierId, { view: "activity", from: date, to: date });
  return data ? data.closing : null;
}

export async function getStatementCheck(id: string) {
  const org = await requireOrg();
  const check = await one<Omit<SupplierStatementCheckRow, "file_content"> & { checked_by_name: string | null; has_file: boolean }>(`
    select c.id, c.organisation_id, c.supplier_id, c.statement_date, c.their_balance, c.our_balance, c.explained, c.unexplained, c.agreed, c.notes,
           c.file_name, c.file_type, c.checked_by, c.created_at, u.name as checked_by_name, c.file_content is not null as has_file
      from supplier_statement_checks c left join app_users u on u.id = c.checked_by
     where c.id = $1 and c.organisation_id = $2`, [id, org.id]);
  return check;
}

/** Their statement as it was kept with a check, to open again. */
export async function getStatementCheckFile(id: string) {
  const org = await requireOrg();
  return one<{ file_name: string | null; file_type: string; file_content: Uint8Array }>(
    "select file_name, file_type, file_content from supplier_statement_checks where id = $1 and organisation_id = $2 and file_content is not null", [id, org.id]);
}

export async function getStatementChecks(supplierId: string) {
  const org = await requireOrg();
  return sql<Pick<SupplierStatementCheckRow, "id" | "statement_date" | "their_balance" | "our_balance" | "unexplained" | "agreed" | "created_at">>(`
    select id, statement_date, their_balance, our_balance, unexplained, agreed, created_at from supplier_statement_checks
     where supplier_id = $1 and organisation_id = $2 order by statement_date desc, created_at desc`, [supplierId, org.id]);
}
