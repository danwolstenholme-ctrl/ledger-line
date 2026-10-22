import { requireOrg } from "@/lib/org";
import { getBalanceSheetReport } from "@/lib/data/accounts";
import { statementCsvHeader, statementCsvRows } from "@/lib/domain/accounts";
import { csvResponse, searchParams, unavailable } from "@/lib/data/csv";

export async function GET(request: Request) {
  await requireOrg();
  const report = await getBalanceSheetReport(searchParams(request));
  if (report.failed) return unavailable("balance sheet");
  return csvResponse(`balance-sheet-${report.period.asAt}`,
    statementCsvHeader(report.columns.map(column => column.label), report), statementCsvRows(report.rows, report));
}
