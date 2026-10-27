import { requireOrg } from "@/lib/org";
import { getVatReport } from "@/lib/data/accounts";
import { vatBoxes } from "@/lib/domain/accounts";
import { csvResponse, searchParams, unavailable } from "@/lib/data/csv";

export async function GET(request: Request) {
  await requireOrg();
  const report = await getVatReport(searchParams(request));
  if (report.failed) return unavailable("VAT return");
  const { vat, values } = vatBoxes(report.summary, report.breakdown);
  return csvResponse(`vat-return-${report.period.from}-to-${report.period.to}`, ["Box", "Description", "Amount"],
    [...vat, ...values].map(box => [box.box, box.label, box.amount.toFixed(2)]));
}
