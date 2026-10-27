import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { getBalanceSheetReport } from "@/lib/data/accounts";
import { SHEET_COMPARISONS } from "@/lib/domain/accounts";
import { formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, Statement } from "@/components/accounts/report-parts";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const report = await getBalanceSheetReport(await searchParams);
  const { period } = report;
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to, compare: report.compare });
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Balance sheet" back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/balance-sheet" range={period.range} from={period.from} to={period.asAt} asAt
      choices={[{ name: "compare", label: "Columns", value: report.compare, options: SHEET_COMPARISONS }]} />
    <ReportHeading period={`As at ${formatDate(period.asAt)}`} exportHref={`/accounts/reports/balance-sheet/export?${query}`} />
    {report.failed ? <RecordFailure what="the balance sheet" /> : <>
      {!report.balanced ? <p role="alert" className="border-critical/40 text-critical rounded-md border px-4 py-2.5 text-[12.5px]">Net assets and capital do not agree. The trial balance will show which account is out.</p> : null}
      <Statement rows={report.rows} columns={report.columns} compared={report.compared} />
    </>}
  </PageBody>;
}
