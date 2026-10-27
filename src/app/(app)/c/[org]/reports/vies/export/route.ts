import { requireOrg } from "@/lib/org";
import { getViesReport } from "@/lib/data/accounts";
import { csvResponse, searchParams } from "@/lib/data/csv";

/** The VIES statement as a spreadsheet: member state, VAT number, customer, value of services. */
export async function GET(request: Request) {
  await requireOrg();
  const report = await getViesReport(searchParams(request));
  return csvResponse(`vies-${report.period.from}-to-${report.period.to}`, ["Member state", "VAT number", "Customer", "Invoices", "Credit notes", "Value of services"],
    report.lines.map(line => [line.vies_country, line.vies_number, line.name, String(line.invoices), String(line.credit_notes), line.value.toFixed(2)]));
}
