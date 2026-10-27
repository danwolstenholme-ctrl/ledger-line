import { sql } from "@/lib/db";
import { csvResponse } from "@/lib/data/csv";
import { requireOrg } from "@/lib/org";

/** The price list as a spreadsheet, in the columns the import reads back. */
export async function GET() {
  const org = await requireOrg();
  const rows = await sql<{ code: string | null; name: string; unit: string | null; unit_price: number; vat_rate: number; account: string; active: boolean }>(`
    select i.code, i.name, i.unit, i.unit_price, i.vat_rate, a.code as account, i.is_active as active
      from items i join ledger_accounts a on a.id = i.account_id where i.organisation_id = $1 order by i.is_active desc, i.name`, [org.id]);
  return csvResponse(`${org.slug}-products`, ["Code", "Name", "Unit", "Price", "VAT rate", "Account", "Sold"],
    rows.map(row => [row.code ?? "", row.name, row.unit ?? "", String(Number(row.unit_price)), String(Number(row.vat_rate)), row.account, row.active ? "Yes" : "No"]));
}
