import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { getCashMovements, getLedgerBalances, getReportPeriod } from "@/lib/data/accounts";
import { cashFlow, cashFlowRows, periodHeading, toDate } from "@/lib/domain/accounts";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, Statement, periodLabel } from "@/components/accounts/report-parts";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Cash flow" };

/** The direct method: each bank entry classified by what was on its other side. */
export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const base = await getReportPeriod(await searchParams);
  const period = toDate(base, base.today);
  const [movements, balances] = await Promise.all([getCashMovements(period.from, period.to), getLedgerBalances(period.from, period.to)]);
  const flow = cashFlow(movements.rows, balances.rows);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Cash flow" back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/cash-flow" range={period.range} from={period.from} to={period.to} />
    <ReportHeading period={periodLabel(period.from, period.to)} />
    {movements.failed || balances.failed ? <RecordFailure what="the cash flow" /> : <>
      <Statement rows={cashFlowRows(flow)} columns={[{ label: periodHeading(period.from, period.to), from: period.from, to: period.to }]} />
      <p className="text-ink-faint px-0.5 text-[12px]">Money moved between the company’s own bank accounts is left out. {flow.reconciles ? "The start and end figures agree with the bank balances." : "The figures do not agree with the bank balances; the trial balance will show why."}</p>
    </>}
  </PageBody>;
}
