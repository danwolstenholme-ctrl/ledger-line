"use server";

import { revalidatePath } from "next/cache";

import { asDbError, sql, transaction } from "@/lib/db";
import { describeDbError } from "@/lib/actions/form";
import { freeSlug, openCompany } from "@/lib/clients/open-company";
import { clientKeys, readClientRow, type ClientValues } from "@/lib/domain/client-import";
import { firmToday } from "@/lib/domain/invoices";
import { getCurrentUser, getPractice, requirePracticeMember } from "@/lib/org";

export type ClientImportState = {
  ok: boolean; error: string | null;
  added?: { name: string; slug: string }[]; skipped?: string[]; problems?: { row: number; problem: string }[];
};

/**
 * A practice's existing clients brought over in one go: each row a company
 * whose books open now, shaped to its kind of business, with its client file
 * marked as brought over (its engagement letter and due diligence were kept
 * outside Ledgerline, and are added as they come up for review). Each row is
 * read again here as the preview read it; a company already a client (the
 * same registration or VAT number, or name) is left alone. All or nothing.
 */
export async function importClients(_previous: ClientImportState, form: FormData): Promise<ClientImportState> {
  await requirePracticeMember();
  const [practice, user] = await Promise.all([getPractice(), getCurrentUser()]);
  let mapping: Record<string, number | null>, rows: string[][];
  try {
    mapping = JSON.parse(String(form.get("mapping") ?? "{}"));
    rows = JSON.parse(String(form.get("rows") ?? "[]"));
  } catch { return { ok: false, error: "The file could not be read. Choose it again." }; }
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "There are no rows to import." };
  if (rows.length > 1000) return { ok: false, error: "Import up to 1,000 clients at a time." };
  const today = firmToday();
  const [staff, existing] = await Promise.all([
    sql<{ name: string }>("select name from practice_staff where practice_id = $1 order by name", [practice.id]),
    sql<{ name: string; he_number: string | null; vat_number: string | null }>(`select name, he_number, vat_number from organisations where practice_id = $1
      union all select company_name, he_number, vat_number from client_files where practice_id = $1 and status <> 'declined'`, [practice.id]),
  ]);
  const known = new Set(existing.flatMap(row => clientKeys(row)));
  const problems: { row: number; problem: string }[] = [], skipped: string[] = [], ready: ClientValues[] = [];
  rows.forEach((cells, index) => {
    const read = readClientRow(Array.isArray(cells) ? cells.map(String) : [], mapping, index + 2, today, staff.map(person => person.name));
    if (read.problem || !read.values) { problems.push({ row: read.row, problem: read.problem ?? "Unreadable" }); return; }
    const keys = clientKeys(read.values);
    if (keys.some(key => known.has(key))) { skipped.push(read.values.name); return; }
    keys.forEach(key => known.add(key));
    ready.push(read.values);
  });
  const added: { name: string; slug: string }[] = [];
  if (ready.length) {
    try {
      await transaction(async run => {
        // Each company opened goes on the audit trail, whose turn is held to the end: taken first, before this holds anything
        // another import could be waiting on (a company's name), so two imports can't wait on each other.
        await run("select pg_advisory_xact_lock(hashtext('ledgerline.audit_log'))");
        const taken = new Set<string>();
        for (const client of ready) {
          const slug = await freeSlug(run, client.name, taken);
          const org = await openCompany(run, {
            practiceId: practice.id, name: client.name, business: client.business, businessType: client.business_type, country: client.country, heNumber: client.he_number,
            vatNumber: client.vat_number, vatRegistered: client.vat_registered, tic: client.tic, quarterEndMonth: client.vat_quarter_end_month, yearEndMonth: client.year_end_month,
            contactName: client.contact_name, contactEmail: client.contact_email, address: client.address, manager: client.manager, booksFrom: client.books_from,
            incorporatedOn: client.incorporated_on, fee: { monthly: client.monthly_fee, hourly: 0, app: 0 },
          }, slug);
          await run(`insert into client_files (practice_id, organisation_id, status, company_name, he_number, incorporated_on, registered_address, business, business_type, contact_name, contact_email,
              contact_phone, services, monthly_fee, vat_registered, vat_number, vat_quarter_end_month, year_end_month, books_from, manager, country, created_by, opened_at, opened_by, imported_at)
            values ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, now(), $21, now())`,
            [practice.id, org, client.name, client.he_number, client.incorporated_on, client.address, client.business, client.business_type, client.contact_name, client.contact_email,
             client.contact_phone, ["bookkeeping", ...(client.vat_registered ? ["vat"] : []), "tax_return"], client.monthly_fee, client.vat_registered, client.vat_number,
             client.vat_quarter_end_month, client.year_end_month, client.books_from, client.manager, client.country, user.name]);
          added.push({ name: client.name, slug });
        }
      });
    } catch (error) {
      const failure = asDbError(error);
      console.error("[client import] failed", failure.code);
      return { ok: false, error: describeDbError(failure, "The clients could not be imported. Nothing was added."), problems, skipped };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, error: null, added, skipped, problems };
}
