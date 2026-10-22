import { requireOrg } from "@/lib/org";
import { getProfitAndLossReport } from "@/lib/data/accounts";
import { statementCsvHeader, statementCsvRows } from "@/lib/domain/accounts";
import { csvResponse, searchParams, unavailable } from "@/lib/data/csv";

export async function GET(request: Request) {
  await requireOrg();
  const report = await getProfitAndLossReport(searchParams(request));
  if (report.failed) return unavailable("profit and loss");
  return csvResponse(`profit-and-loss-${report.period.from}-to-${report.period.to}`,
    statementCsvHeader(report.columns.map(column => column.label), report), statementCsvRows(report.rows, report));
}
