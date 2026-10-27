import { sql } from "@/lib/db";
import { csvResponse } from "@/lib/data/csv";
import { requireOrg } from "@/lib/org";

/** Every customer as a spreadsheet, in the columns the import reads back. */
export async function GET() {
  const org = await requireOrg();
  const rows = await sql<{ name: string; email: string | null; phone: string | null; vat_number: string | null; country: string; address: string | null; payment_terms_days: number | null; owed: number }>(`
    select c.name, c.email, c.phone, c.vat_number, c.country, c.address, c.payment_terms_days,
           coalesce((select sum(balance) from v_invoice_directory i where i.customer_id = c.id and i.status in ('issued', 'part_paid')), 0) as owed
      from customers c where c.organisation_id = $1 order by c.name`, [org.id]);
  return csvResponse(`${org.slug}-customers`, ["Name", "Email", "Phone", "VAT number", "Country", "Address", "Payment terms", "Owes"],
    rows.map(row => [row.name, row.email ?? "", row.phone ?? "", row.vat_number ?? "", row.country, row.address ?? "", row.payment_terms_days === null ? "" : String(row.payment_terms_days), Number(row.owed).toFixed(2)]));
}
