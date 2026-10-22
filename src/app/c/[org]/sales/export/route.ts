import { sql } from "@/lib/db";
import { csvResponse } from "@/lib/data/csv";
import { requireOrg } from "@/lib/org";
import type { InvoiceDirectoryRow } from "@/types/database";

/** Every invoice as a spreadsheet: what was billed, paid, credited and still owed. */
export async function GET() {
  const org = await requireOrg();
  const rows = await sql<InvoiceDirectoryRow>("select * from v_invoice_directory where organisation_id = $1 order by issued_on, number", [org.id]);
  return csvResponse(`${org.slug}-invoices`, ["Number", "Date", "Due", "Customer", "Customer VAT number", "Their reference", "VAT", "Net", "VAT amount", "Total", "Paid", "Credited", "Still owed", "Status", "Sent"],
    rows.map(row => [row.number, row.issued_on, row.due_on ?? "", row.client_name, row.client_vat_number ?? "", row.reference ?? "", row.vat_treatment, Number(row.net).toFixed(2), Number(row.vat_amount).toFixed(2),
      Number(row.total).toFixed(2), Number(row.amount_paid).toFixed(2), Number(row.amount_credited).toFixed(2), Number(row.balance).toFixed(2), row.status, row.sent_at ? row.sent_at.slice(0, 10) : ""]));
}
