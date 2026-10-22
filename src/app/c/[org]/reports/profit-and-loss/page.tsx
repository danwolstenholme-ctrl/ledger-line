import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { getProfitAndLossReport } from "@/lib/data/accounts";
import { PNL_COMPARISONS } from "@/lib/domain/accounts";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, Statement, periodLabel } from "@/components/accounts/report-parts";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Profit and loss" };

export default async function ProfitAndLossPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const report = await getProfitAndLossReport(await searchParams);
  const query = new URLSearchParams({ range: report.period.range, from: report.period.from, to: report.period.to, compare: report.compare });
  return <PageBody width={report.columns.length > 3 ? "full" : "5xl"} className="space-y-4">
    <RecordHeader title="Profit and loss" back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/profit-and-loss" range={report.period.range} from={report.period.from} to={report.period.to}
      choices={[{ name: "compare", label: "Columns", value: report.compare, options: PNL_COMPARISONS }]} />
    <ReportHeading period={periodLabel(report.period.from, report.period.to)} exportHref={`/accounts/reports/profit-and-loss/export?${query}`} />
    {report.failed ? <RecordFailure what="the profit and loss" /> : <Statement rows={report.rows} columns={report.columns} compared={report.compared} />}
  </PageBody>;
}
