import { sql } from "@/lib/db";
import { csvResponse } from "@/lib/data/csv";
import { requireOrg } from "@/lib/org";

/** Every supplier as a spreadsheet, in the columns the import reads back. */
export async function GET() {
  const org = await requireOrg();
  const rows = await sql<{ name: string; email: string | null; phone: string | null; vat_number: string | null; country: string; iban: string | null; bic: string | null; owed: number }>(`
    select s.name, s.email, s.phone, s.vat_number, s.country, s.iban, s.bic,
           coalesce((select sum(balance) from v_bill_directory b where b.supplier_id = s.id and b.status in ('awaiting_payment', 'part_paid')), 0) as owed
      from suppliers s where s.organisation_id = $1 order by s.name`, [org.id]);
  return csvResponse(`${org.slug}-suppliers`, ["Name", "Email", "Phone", "VAT number", "Country", "IBAN", "BIC", "Owed to them"],
    rows.map(row => [row.name, row.email ?? "", row.phone ?? "", row.vat_number ?? "", row.country, row.iban ?? "", row.bic ?? "", Number(row.owed).toFixed(2)]));
}
